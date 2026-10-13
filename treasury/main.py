"""FastAPI application: server-rendered pages, session auth, RBAC, CSRF, audit logging."""
from __future__ import annotations

import os
import secrets
import shutil
import tempfile
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from . import config
from . import interest as I
from . import notify, reports, security
from . import services as S
from .db import get_db, init_db
from .entities import ENTITIES, parse_form
from .models import Account, AuditLog, InternetAccount, Investor, Lease, User

BASE = Path(__file__).parent
templates = Jinja2Templates(directory=str(BASE / "templates"))

app = FastAPI(title="Treasury Platform", docs_url=None, redoc_url=None, openapi_url=None)
_secret = config.SECRET_KEY or secrets.token_urlsafe(32)
if not config.SECRET_KEY:
    print("WARNING: TREASURY_SECRET_KEY not set; using a random key (sessions reset on restart). Set it in production.")
app.add_middleware(SessionMiddleware, secret_key=_secret, same_site="lax", max_age=8 * 3600,
                   https_only=os.environ.get("TREASURY_HTTPS_ONLY", "") == "1")
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")


@app.on_event("startup")
def _startup():
    init_db()


class LoginRequired(Exception):
    pass


@app.exception_handler(LoginRequired)
async def _login_required(request: Request, exc: LoginRequired):
    return RedirectResponse("/login", status_code=303)


def money(v) -> str:
    return "" if v is None or v == "" else f"{Decimal(v):,.2f}"


templates.env.filters["money"] = money
templates.env.globals.update(today=date.today, ROLES=security.ROLES)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if not user or not user.active:
        request.session.clear()
        raise LoginRequired()
    return user


def need(module: str, write: bool = False):
    def dep(user: User = Depends(current_user)) -> User:
        if not security.can(user.role, module, write):
            raise HTTPException(403, "You do not have permission for this action")
        return user
    return dep


def render(request: Request, name: str, user: User | None = None, status: int = 200, **ctx):
    if "csrf" not in request.session:
        request.session["csrf"] = security.new_csrf()
    ctx.update(user=user, csrf=request.session["csrf"], flash=request.session.pop("flash", None),
               can=(lambda m, w=False: bool(user) and security.can(user.role, m, w)))
    return templates.TemplateResponse(request, name, ctx, status_code=status)


async def form_of(request: Request) -> dict:
    form = dict((await request.form()).items())
    if not secrets.compare_digest(str(form.get("csrf_token", "")), str(request.session.get("csrf", "x"))):
        raise HTTPException(403, "Invalid or missing CSRF token")
    return form


def flash(request: Request, msg: str):
    request.session["flash"] = msg


def ip(request: Request) -> str:
    return request.client.host if request.client else ""


# ------------------------------------------------------------------ auth
@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    return render(request, "login.html")


@app.post("/login")
async def login(request: Request, db: Session = Depends(get_db)):
    form = await form_of(request)
    username = str(form.get("username", "")).strip()
    user = db.scalar(select(User).where(User.username == username))
    now = datetime.utcnow()
    err = "Invalid username or password"
    if user and user.locked_until and user.locked_until > now:
        err = "Account temporarily locked. Try again later."
    elif user and user.active and security.verify_password(str(form.get("password", "")), user.password_hash):
        user.failed_attempts, user.locked_until = 0, None
        S.audit(db, user.username, "login", ip=ip(request))
        db.commit()
        csrf = security.new_csrf()
        request.session.clear()
        request.session.update(uid=user.id, csrf=csrf)
        return RedirectResponse("/", status_code=303)
    else:
        if user:
            user.failed_attempts += 1
            if user.failed_attempts >= config.MAX_FAILED_LOGINS:
                user.locked_until = now + timedelta(minutes=config.LOCKOUT_MINUTES)
                user.failed_attempts = 0
        S.audit(db, username[:60], "login_failed", ip=ip(request))
        db.commit()
    return render(request, "login.html", status=401, error=err)


@app.post("/logout")
async def logout(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    await form_of(request)
    S.audit(db, user.username, "logout", ip=ip(request)); db.commit()
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


@app.get("/health")
def health():
    return {"status": "ok"}


# ------------------------------------------------------------------ dashboard
@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = date.today()
    ctx: dict = {}
    if security.can(user.role, "treasury"):
        accts = list(db.scalars(select(Account)))
        live = [a for a in accts if a.status(t) in ("Active", "Matured", "Pending")]
        ctx["tre"] = {
            "investors": db.scalar(select(func.count(Investor.id))), "open_accounts": len(live),
            "principal": sum((S.principal_outstanding(a, t) for a in live), Decimal(0)),
            "accrued": sum((S.accrued(a, t) for a in live), Decimal(0)),
            "maturing": sorted([a for a in live if a.current_term.maturity_date <= t + timedelta(days=30)], key=lambda a: a.current_term.maturity_date),
        }
    if security.can(user.role, "finance"):
        horizon = t + timedelta(days=30)
        due = [("Rent", l.branch_name, l.next_due_date, l.rent_amount, f"/e/leases/{l.id}/edit") for l in db.scalars(select(Lease)) if l.next_due_date <= horizon]
        due += [("Internet", a.branch_name, a.next_due_date, a.monthly_cost, f"/e/internet/{a.id}/edit") for a in db.scalars(select(InternetAccount)) if a.next_due_date <= horizon]
        ctx["due"] = sorted(due, key=lambda r: r[2])
        ctx["expiring"] = [l for l in db.scalars(select(Lease)) if l.lease_expiry and l.lease_expiry <= t + timedelta(days=90)]
    return render(request, "dashboard.html", user, **ctx)


# ------------------------------------------------------------------ generic CRUD
def _ent(key: str):
    ent = ENTITIES.get(key)
    if not ent:
        raise HTTPException(404)
    return ent


def _ref_options(db: Session, ent) -> dict:
    out = {}
    for f in ent.fields:
        if f.kind == "ref":
            r = ENTITIES[f.ref]
            out[f.name] = [(o.id, r.label(o)) for o in db.scalars(select(r.model).order_by(r.model.id))]
    return out


def _ref_ids(db: Session, ent) -> dict:
    return {f.ref: {o.id for o in db.scalars(select(ENTITIES[f.ref].model))} for f in ent.fields if f.kind == "ref"}


@app.get("/e/{key}", response_class=HTMLResponse)
def entity_list(key: str, request: Request, q: str = "", db: Session = Depends(get_db), user: User = Depends(current_user)):
    ent = _ent(key)
    if not security.can(user.role, ent.module):
        raise HTTPException(403)
    qry = select(ent.model).order_by(getattr(ent.model, ent.order).desc() if ent.order in ("paid_on", "request_date") else getattr(ent.model, ent.order))
    if q:
        from sqlalchemy import or_
        qry = qry.where(or_(*[getattr(ent.model, c).ilike(f"%{q}%") for c in ent.search if c != "id"]))
    rows = list(db.scalars(qry.limit(500)))
    refs = {}
    for f in ent.fields:
        if f.kind == "ref":
            r = ENTITIES[f.ref]
            refs[f.name] = {o.id: r.label(o) for o in db.scalars(select(r.model))}
    return render(request, "list.html", user, ent=ent, rows=rows, refs=refs, q=q)


@app.get("/e/{key}/new", response_class=HTMLResponse)
def entity_new(key: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ent = _ent(key)
    if not security.can(user.role, ent.module, True):
        raise HTTPException(403)
    vals = {k: v for k, v in request.query_params.items()}
    return render(request, "form.html", user, ent=ent, vals=vals, errors={}, options=_ref_options(db, ent), obj=None)


def _save(request, db, user, ent, form, obj):
    vals, errs = parse_form(ent, form, _ref_ids(db, ent))
    if errs:
        return render(request, "form.html", user, status=422, ent=ent, vals=form, errors=errs, options=_ref_options(db, ent), obj=obj)
    is_new = obj is None
    obj = obj or ent.model()
    before = {} if is_new else {f.name: str(getattr(obj, f.name)) for f in ent.fields}
    for k, v in vals.items():
        setattr(obj, k, v)
    if ent.before_save:
        ent.before_save(obj)
    db.add(obj)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return render(request, "form.html", user, status=422, ent=ent, vals=form, errors={"__all__": "A record with these unique details already exists"},
                      options=_ref_options(db, ent), obj=None if is_new else obj)
    if ent.after_save:
        ent.after_save(db, obj, is_new)
    changes = "created" if is_new else "; ".join(f"{k}: {before[k]} -> {getattr(obj, k)}" for k in before if before[k] != str(getattr(obj, k)))
    S.audit(db, user.username, "create" if is_new else "update", ent.key, obj.id, changes, ip(request))
    db.commit()
    flash(request, f"{ent.title}: saved")
    return RedirectResponse(ent.detail_url.format(id=obj.id) if ent.detail_url else f"/e/{ent.key}", status_code=303)


@app.post("/e/{key}/new")
async def entity_create(key: str, request: Request, db: Session = Depends(get_db)):
    ent = _ent(key)
    user = need(ent.module, True)(current_user(request, db))
    return _save(request, db, user, ent, await form_of(request), None)


@app.get("/e/{key}/{oid}/edit", response_class=HTMLResponse)
def entity_edit(key: str, oid: int, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    ent = _ent(key)
    if not security.can(user.role, ent.module, True):
        raise HTTPException(403)
    obj = db.get(ent.model, oid) or (_ for _ in ()).throw(HTTPException(404))
    vals = {f.name: ("" if getattr(obj, f.name) is None else str(getattr(obj, f.name))) for f in ent.fields}
    return render(request, "form.html", user, ent=ent, vals=vals, errors={}, options=_ref_options(db, ent), obj=obj)


@app.post("/e/{key}/{oid}/edit")
async def entity_update(key: str, oid: int, request: Request, db: Session = Depends(get_db)):
    ent = _ent(key)
    user = need(ent.module, True)(current_user(request, db))
    obj = db.get(ent.model, oid) or (_ for _ in ()).throw(HTTPException(404))
    return _save(request, db, user, ent, await form_of(request), obj)


# ------------------------------------------------------------------ investors & accounts
@app.get("/investors/{iid}", response_class=HTMLResponse)
def investor_detail(iid: int, request: Request, db: Session = Depends(get_db), user: User = Depends(need("treasury"))):
    inv = db.get(Investor, iid) or (_ for _ in ()).throw(HTTPException(404))
    t = date.today()
    rows = [dict(a=a, status=a.status(t), accrued=S.accrued(a, t), principal=S.principal_outstanding(a, t)) for a in inv.accounts]
    total_p = sum((r["principal"] for r in rows), Decimal(0))
    total_i = sum((r["accrued"] for r in rows if not r["a"].redemption_date), Decimal(0))
    return render(request, "investor.html", user, inv=inv, rows=rows, total_p=total_p, total_i=total_i, net=total_p + total_i,
                  suggested_ref=f"CP-{inv.id:04d}-{len(inv.accounts) + 1:02d}")


@app.post("/investors/{iid}/accounts")
async def account_create(iid: int, request: Request, db: Session = Depends(get_db)):
    user = need("treasury", True)(current_user(request, db))
    f = await form_of(request)
    inv = db.get(Investor, iid) or (_ for _ in ()).throw(HTTPException(404))
    try:
        recv = date.fromisoformat(f["date_received"])
        start = date.fromisoformat(f.get("start_date") or f["date_received"])
        acct = S.create_account(db, iid, f["reference"].strip(), recv, Decimal(f["principal"].replace(",", "")),
                                Decimal(f["rate_pct"]), start, date.fromisoformat(f["maturity_date"]))
        if not f["reference"].strip():
            raise ValueError("Reference is required")
        db.flush()
    except IntegrityError:
        db.rollback(); flash(request, "Error: that investment reference already exists")
        return RedirectResponse(f"/investors/{iid}", status_code=303)
    except (ValueError, KeyError, InvalidOperation) as exc:
        db.rollback(); flash(request, f"Error: {exc if isinstance(exc, ValueError) else 'invalid or missing values'}")
        return RedirectResponse(f"/investors/{iid}", status_code=303)
    S.audit(db, user.username, "create", "account", acct.id, f"{acct.reference} principal {f['principal']} @ {f['rate_pct']}%", ip(request))
    db.commit(); flash(request, "Investment account created")
    return RedirectResponse(f"/accounts/{acct.id}", status_code=303)


@app.get("/accounts/{aid}", response_class=HTMLResponse)
def account_detail(aid: int, request: Request, db: Session = Depends(get_db), user: User = Depends(need("treasury"))):
    a = db.get(Account, aid) or (_ for _ in ()).throw(HTTPException(404))
    t = date.today()
    terms = a.interest_terms()
    monthly = I.monthly_schedule(terms, t, a.redemption_date)
    first = min(x.start for x in terms)
    quarters, y, q = [], first.year, (first.month - 1) // 3 + 1
    while I.quarter_bounds(y, q)[0] <= t:
        s, e = I.quarter_bounds(y, q)
        g = S.period_gross(a, s, e, t)
        quarters.append((f"Q{q} {y}", g, I.withholding_tax(g), g - I.withholding_tax(g)))
        y, q = (y + 1, 1) if q == 4 else (y, q + 1)
    daily = I.daily_schedule(terms, max(first, t - timedelta(days=14)), t, a.redemption_date)[::-1]
    return render(request, "account.html", user, a=a, acct_status=a.status(t), accrued=S.accrued(a, t), monthly=monthly[::-1],
                  quarters=quarters[::-1], daily=daily,
                  history=db.scalars(select(AuditLog).where(AuditLog.entity == "account", AuditLog.entity_id == str(a.id)).order_by(AuditLog.id.desc())).all(),
                  wht=config.WHT_RATE)


@app.post("/accounts/{aid}/{action}")
async def account_action(aid: int, action: str, request: Request, db: Session = Depends(get_db)):
    user = need("treasury", True)(current_user(request, db))
    f = await form_of(request)
    a = db.get(Account, aid) or (_ for _ in ()).throw(HTTPException(404))
    try:
        if action == "rollover":
            term = S.rollover(db, a, Decimal(f["rate_pct"]), date.fromisoformat(f["maturity_date"]), date.today())
            detail = f"rolled over principal {term.principal} @ {term.rate_pct}% from {term.start_date} to {term.maturity_date}"
        elif action == "redeem":
            S.redeem(a, date.fromisoformat(f["redemption_date"]))
            detail = f"redeemed on {a.redemption_date}"
        elif action == "adjust":
            adj = S.add_adjustment(a, date.fromisoformat(f["effective_date"]), Decimal(f["amount"]), f.get("reason", ""), user.username)
            detail = f"adjustment {adj.amount} effective {adj.effective_date}: {adj.reason}"
        else:
            raise HTTPException(404)
    except (ValueError, KeyError, InvalidOperation) as exc:
        db.rollback(); flash(request, f"Error: {exc if isinstance(exc, ValueError) else 'invalid or missing values'}")
        return RedirectResponse(f"/accounts/{aid}", status_code=303)
    S.audit(db, user.username, action, "account", a.id, detail, ip(request))
    db.commit(); flash(request, f"Done: {detail}")
    return RedirectResponse(f"/accounts/{aid}", status_code=303)


# ------------------------------------------------------------------ reports
@app.get("/reports", response_class=HTMLResponse)
def reports_index(request: Request, user: User = Depends(current_user)):
    avail = {k: v for k, v in reports.REPORTS.items() if security.can(user.role, v["module"])}
    return render(request, "reports.html", user, avail=avail)


@app.get("/reports/{key}")
def report_view(key: str, request: Request, fmt: str = "html", db: Session = Depends(get_db), user: User = Depends(current_user)):
    spec = reports.REPORTS.get(key) or (_ for _ in ()).throw(HTTPException(404))
    if not security.can(user.role, spec["module"]):
        raise HTTPException(403)
    raw = dict(request.query_params)
    has_params = bool(raw) or not spec["params"]
    opts = {"investors": [(i.id, i.name) for i in db.scalars(select(Investor).order_by(Investor.name))],
            "accounts": [(a.id, f"{a.reference} - {a.investor.name}") for a in db.scalars(select(Account))]}
    if not has_params:
        return render(request, "report_form.html", user, key=key, spec=spec, opts=opts, vals=reports.parse_params(spec["params"], {}) if spec["params"] else {})
    try:
        p = reports.parse_params(spec["params"], raw)
        rep = spec["fn"](db, p)
    except (ValueError, TypeError, AttributeError):
        flash(request, "Please check the report parameters")
        return RedirectResponse(f"/reports/{key}", status_code=303)
    S.audit(db, user.username, f"report_{fmt}", "report", key, str(raw)[:500], ip(request)); db.commit()
    safe = key.replace("_", "-")
    if fmt == "xlsx":
        return Response(reports.to_xlsx(rep), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="{safe}.xlsx"'})
    if fmt == "pdf":
        return Response(reports.to_pdf(rep), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{safe}.pdf"'})
    qs = "&".join(f"{k}={v}" for k, v in raw.items() if k != "fmt")
    return render(request, "report.html", user, rep=rep, key=key, qs=qs)


# ------------------------------------------------------------------ admin
@app.get("/admin/users", response_class=HTMLResponse)
def users_page(request: Request, db: Session = Depends(get_db), user: User = Depends(need("admin"))):
    return render(request, "users.html", user, users=db.scalars(select(User).order_by(User.username)).all())


@app.post("/admin/users")
async def users_create(request: Request, db: Session = Depends(get_db)):
    admin = need("admin", True)(current_user(request, db))
    f = await form_of(request)
    probs = security.password_problems(f.get("password", ""))
    if f.get("role") not in security.ROLES or not f.get("username", "").strip() or probs:
        flash(request, "Error: " + ("password needs " + ", ".join(probs) if probs else "username and valid role required"))
        return RedirectResponse("/admin/users", status_code=303)
    try:
        u = User(username=f["username"].strip(), full_name=f.get("full_name", ""), email=f.get("email", ""), role=f["role"],
                 password_hash=security.hash_password(f["password"]))
        db.add(u); db.flush()
    except IntegrityError:
        db.rollback(); flash(request, "Error: username already exists")
        return RedirectResponse("/admin/users", status_code=303)
    S.audit(db, admin.username, "create", "user", u.id, f"{u.username} role {u.role}", ip(request)); db.commit()
    flash(request, "User created")
    return RedirectResponse("/admin/users", status_code=303)


@app.post("/admin/users/{uid}/{action}")
async def users_action(uid: int, action: str, request: Request, db: Session = Depends(get_db)):
    admin = need("admin", True)(current_user(request, db))
    f = await form_of(request)
    u = db.get(User, uid) or (_ for _ in ()).throw(HTTPException(404))
    if action == "toggle":
        if u.id == admin.id:
            flash(request, "You cannot deactivate yourself")
            return RedirectResponse("/admin/users", status_code=303)
        u.active = not u.active; detail = f"active={u.active}"
    elif action == "role" and f.get("role") in security.ROLES:
        if u.id == admin.id:
            flash(request, "You cannot change your own role")
            return RedirectResponse("/admin/users", status_code=303)
        u.role = f["role"]; detail = f"role={u.role}"
    elif action == "password":
        probs = security.password_problems(f.get("password", ""))
        if probs:
            flash(request, "Error: password needs " + ", ".join(probs))
            return RedirectResponse("/admin/users", status_code=303)
        u.password_hash = security.hash_password(f["password"]); u.failed_attempts, u.locked_until = 0, None; detail = "password reset"
    else:
        raise HTTPException(400)
    S.audit(db, admin.username, f"user_{action}", "user", u.id, detail, ip(request)); db.commit()
    flash(request, f"{u.username}: {detail}")
    return RedirectResponse("/admin/users", status_code=303)


@app.get("/admin/audit", response_class=HTMLResponse)
def audit_page(request: Request, q: str = "", db: Session = Depends(get_db), user: User = Depends(need("admin"))):
    qry = select(AuditLog).order_by(AuditLog.id.desc()).limit(500)
    if q:
        qry = select(AuditLog).where((AuditLog.username.ilike(f"%{q}%")) | (AuditLog.action.ilike(f"%{q}%")) | (AuditLog.entity.ilike(f"%{q}%"))).order_by(AuditLog.id.desc()).limit(500)
    return render(request, "audit.html", user, logs=db.scalars(qry).all(), q=q)


@app.get("/admin/tools", response_class=HTMLResponse)
def tools_page(request: Request, user: User = Depends(need("admin"))):
    return render(request, "tools.html", user)


@app.post("/admin/run/{job}")
async def run_job(job: str, request: Request, db: Session = Depends(get_db)):
    user = need("admin", True)(current_user(request, db))
    await form_of(request)
    if job == "reminders":
        sent = notify.run_reminders(db, date.today()); msg = f"Reminders sent: {len(sent)}"
    elif job == "accrual":
        n = S.run_daily_accrual(db, date.today() - timedelta(days=1)); msg = f"Accrual snapshots written for yesterday: {n}"
    else:
        raise HTTPException(404)
    S.audit(db, user.username, f"job_{job}", "system", "", msg, ip(request)); db.commit(); flash(request, msg)
    return RedirectResponse("/admin/tools", status_code=303)


@app.post("/admin/backup")
async def backup(request: Request, db: Session = Depends(get_db)):
    user = need("admin", True)(current_user(request, db))
    await form_of(request)
    if not config.DATABASE_URL.startswith("sqlite:///"):
        flash(request, "Backups for this database type must be taken with the database's own tooling")
        return RedirectResponse("/admin/tools", status_code=303)
    import sqlite3
    src = config.DATABASE_URL.replace("sqlite:///", "", 1)
    tmp = Path(tempfile.mkdtemp()) / f"treasury-backup-{datetime.utcnow():%Y%m%d-%H%M%S}.db"
    with sqlite3.connect(src) as s, sqlite3.connect(tmp) as d:   # consistent online backup
        s.backup(d)
    S.audit(db, user.username, "backup", "system", "", tmp.name, ip(request)); db.commit()
    return FileResponse(tmp, filename=tmp.name, media_type="application/octet-stream")
