/* Biotoron — واجهة GitHub Pages فوق Supabase. كل العمليات بتعدّي على دوال قاعدة البيانات (RPC)
   والصلاحيات متأمّنة هناك، مش هنا. */
(function () {
  "use strict";
  var CFG = window.BT_CONFIG || {};
  var ROLES = { admin: "الأدمن", sales: "السيلز", operations: "العمليات", warehouse: "المخزن", shipping: "الشحن", none: "بدون دور" };
  var STATUSES = { new: "جديد", preparing: "جاري التحضير", ready: "جاهز للشحن", shipped: "خرج للتوصيل", delivered: "تم التسليم", cancelled: "ملغي", returned: "مرتجع" };
  var PAY = { cod: "دفع عند الاستلام", deposit: "عربون + الباقي عند الاستلام", full: "دفع كامل مقدماً" };
  var CATS = { GLASS: "زجاجيات", PRO: "أجهزة ومستلزمات" };
  var MOVE = { opening: "رصيد افتتاحي", receive: "إضافة", adjust: "تعديل/جرد", order_out: "خرج لأوردر", return_in: "مرتجع" };
  var LOGI = { created: "📝 إنشاء", preparing: "🔧 تحضير", ready: "📦 جاهز", shipped: "🚚 تم الشحن", delivered: "✅ تسليم", returned: "↩️ مرتجع", cancelled: "❌ إلغاء", payment: "💰 دفع", edit: "✏️ تعديل", restock: "📥 مخزن", note: "💬 ملاحظة" };

  var sb, me = null, lastNotif = 0, products = [], view = { name: "" };

  // ---------- أدوات ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function Raw(s) { this.s = s; }
  function val(v) { if (v instanceof Raw) return v.s; if (Array.isArray(v)) return v.map(val).join(""); return esc(v); }
  function h(strs) { var out = strs[0]; for (var i = 1; i < arguments.length; i++) out += val(arguments[i]) + strs[i]; return new Raw(out); }
  function raw(s) { return new Raw(s); }
  function money(v) { var n = Number(v || 0); return n.toLocaleString("en-US", { maximumFractionDigits: 2 }); }
  function ono(id) { return "BT-" + String(id).padStart(5, "0"); }
  function dt(s) {
    if (!s) return "";
    try { return "⁦" + new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(s)).replace(",", "") + "⁩"; } catch (e) { return s; }
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function can(set) { return set.indexOf(me.role) > -1; }
  var PRICE = ["admin", "operations", "sales"], CONTACT = ["admin", "operations", "sales", "shipping"];

  async function rpc(name, args) {
    var r = await sb.rpc(name, args || {});
    if (r.error) throw new Error(r.error.message || "حصل خطأ");
    return r.data;
  }
  async function callFn(body) {
    var r = await sb.functions.invoke("admin-users", { body: body });
    if (r.error) {
      var msg = r.error.message || "حصل خطأ";
      try { var j = await r.error.context.json(); if (j && j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    return r.data;
  }
  var flashMsg = null;
  function flash(msg, kind) { flashMsg = { msg: msg, kind: kind || "ok" }; }
  function flashHtml() { if (!flashMsg) return ""; var f = flashMsg; flashMsg = null; return '<div class="flash ' + f.kind + '">' + esc(f.msg) + "</div>"; }
  function spill(s) { return h`<span class="pill s-${s}">${STATUSES[s]}</span>`; }
  function stState(p) { var a = p.qty - p.reserved; return a <= 0 ? ["out", "نفد"] : a <= p.min_qty ? ["low", "قليل"] : ["ok", "متوفر"]; }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function qs(hash) { var i = hash.indexOf("?"); var o = {}; if (i > -1) new URLSearchParams(hash.slice(i + 1)).forEach(function (v, k) { o[k] = v; }); return o; }
  function setMain(x) { $("#main").innerHTML = (x instanceof Raw ? x.s : x); }

  // ---------- الشريط العلوي ----------
  function topbar() {
    var el = $("#topbar");
    if (!me || me.role === "none") { el.innerHTML = ""; return; }
    var cur = location.hash;
    var on = function (p) { return cur.indexOf(p) === 0 ? "on" : ""; };
    el.innerHTML = '<header class="top"><div class="top-in"><a class="logo" href="#/">Biotoron</a><nav>' +
      '<a href="#/" class="' + (cur === "#/" || cur === "" ? "on" : "") + '">الرئيسية</a>' +
      '<a href="#/orders" class="' + on("#/orders") + '">الأوردرات</a><a href="#/stock" class="' + on("#/stock") + '">المخزن</a>' +
      (can(["sales", "admin"]) ? '<a href="#/orders/new" class="nav-cta">+ أوردر جديد</a>' : "") +
      (me.role === "admin" ? '<a href="#/movements" class="' + on("#/movements") + '">حركة المخزن</a><a href="#/users" class="' + on("#/users") + '">الحسابات</a>' : "") +
      '</nav><a class="bell" href="#/notifications" title="الإشعارات">🔔<span class="badge" id="badge" ' + (me.unread ? "" : "hidden") + ">" + (me.unread || 0) + "</span></a>" +
      '<div class="who"><span>' + esc(me.name) + " · " + ROLES[me.role] + '</span> <a href="#/password" style="color:#d9f3ef">الباسورد</a> <button class="linkbtn" data-click="lang">' + BT_I18N.toggleLabel + '</button> <button class="linkbtn" data-click="logout">خروج</button></div></div></header>';
  }
  function setBadge(n) {
    me.unread = n; var b = $("#badge"); if (!b) return; b.textContent = n > 99 ? "99+" : n; b.hidden = !n;
    document.title = (n ? "(" + n + ") " : "") + "Biotoron";
  }

  // ---------- الدخول ----------
  function loginView(err) {
    $("#topbar").innerHTML = "";
    setMain(h`<div class="login-wrap"><div class="brandbig">Biotoron</div><p style="text-align:center" class="muted">سيستم المبيعات والمخزن والشحن</p>
      <form class="card" data-act="login">${err ? h`<div class="flash err">${err}</div>` : ""}
      <label>الإيميل</label><input type="email" name="email" required autofocus autocomplete="username" dir="ltr">
      <label>الباسورد</label><input type="password" name="password" required autocomplete="current-password" dir="ltr">
      <p><button class="btn lg" style="width:100%">دخول</button></p></form>
      <p style="text-align:center"><button type="button" class="linkbtn" style="color:var(--brand)" data-click="lang">${BT_I18N.toggleLabel}</button></p></div>`);
  }
  function pendingView() {
    topbar();
    setMain(h`<div class="card" style="max-width:480px;margin:10vh auto;text-align:center"><h2>حسابك لسه مستني التفعيل</h2>
      <p class="muted">الأدمن لازم يحدد دورك (سيلز / مخزن / شحن...) قبل ما تقدر تستخدم السيستم. اتواصل معاه وبعدين حدّث الصفحة.</p>
      <p><button class="btn" data-click="reload">تحديث</button> <button class="btn sec" data-click="logout">خروج</button> <button class="btn sec" data-click="lang">${BT_I18N.toggleLabel}</button></p></div>`);
    $("#topbar").innerHTML = "";
  }

  // ---------- الراوتر ----------
  var LIVE = { dashboard: 1, stock: 1, orders: 1, order: 1 };
  async function route() {
    if (!me) return;
    if (me.role === "none") return pendingView();
    var hash = location.hash || "#/";
    var path = hash.split("?")[0], q = qs(hash), m;
    topbar();
    try {
      if (path === "#/" || path === "#" || path === "") { view = { name: "dashboard" }; await vDashboard(); }
      else if (path === "#/stock") { view = { name: "stock" }; await vStock(q); }
      else if (path === "#/stock/new") { view = { name: "product" }; await vProduct(null); }
      else if ((m = path.match(/^#\/stock\/(\d+)$/))) { view = { name: "product" }; await vProduct(+m[1]); }
      else if (path === "#/movements") { view = { name: "movements" }; await vMovements(); }
      else if (path === "#/orders") { view = { name: "orders" }; await vOrders(q); }
      else if (path === "#/orders/new") { view = { name: "order_new" }; await vOrderNew(); }
      else if ((m = path.match(/^#\/orders\/(\d+)$/))) { view = { name: "order" }; await vOrder(+m[1]); }
      else if (path === "#/users") { view = { name: "users" }; await vUsers(); }
      else if (path === "#/notifications") { view = { name: "notifs" }; await vNotifs(); }
      else if (path === "#/password") { view = { name: "password" }; vPassword(); }
      else setMain(h`<div class="card" style="text-align:center"><h1>404</h1><p>الصفحة مش موجودة.</p><a class="btn" href="#/">الرئيسية</a></div>`);
    } catch (e) {
      setMain(h`${raw(flashHtml())}<div class="card"><div class="flash err">${e.message}</div><a class="btn" href="#/">الرئيسية</a></div>`);
    }
    if (view.name !== "notifs") window.scrollTo(0, 0);
  }

  // ---------- جداول مشتركة ----------
  function ordersTable(rows, showSeller) {
    var pr = can(PRICE), ct = can(CONTACT);
    return h`<div class="tw"><table><tr><th>الأوردر</th><th>العميل</th>${ct ? h`<th>المحافظة</th>` : ""}<th>الأصناف</th>${pr ? h`<th>الإجمالي</th><th>الدفع</th>` : ""}<th>الحالة</th>${showSeller ? h`<th>السيلز</th>` : ""}<th>الوقت</th></tr>
      ${rows.length ? rows.map(function (o) {
        return h`<tr><td><a href="#/orders/${o.id}"><b>${ono(o.id)}</b></a></td><td>${o.customer_name}</td>${ct ? h`<td>${o.governorate}</td>` : ""}<td class="num">${o.n_items}</td>
        ${pr ? h`<td class="num">${money(o.total)}</td><td class="small">${PAY[o.payment_type]}${o.payment_type !== "cod" && !o.payment_confirmed ? h` <span class="pill s-preparing">لم يُؤكد</span>` : ""}</td>` : ""}
        <td>${spill(o.status)}</td>${showSeller ? h`<td class="small">${o.seller}</td>` : ""}<td class="small muted">${dt(o.created_at)}</td></tr>`;
      }) : h`<tr><td colspan="9" class="muted" style="text-align:center;padding:1.5rem">مفيش أوردرات</td></tr>`}</table></div>`;
  }

  // ---------- الرئيسية ----------
  async function vDashboard() {
    var d = await rpc("dashboard"), c = d.counts || {}, role = me.role;
    var orders = await rpc("list_orders", { p_status: role === "warehouse" || role === "shipping" ? "active" : "", p_q: "", p_limit: 40 });
    if (role === "warehouse") orders = orders.filter(function (o) { return o.status === "new" || o.status === "preparing"; });
    if (role === "shipping") orders = orders.filter(function (o) { return o.status === "ready" || o.status === "shipped"; });
    orders = orders.slice(0, 12);
    var cnt = function (s) { return c[s] || 0; };
    var stat = function (s) { return h`<a class="stat ${s === "new" && cnt("new") && can(["warehouse", "operations", "admin"]) ? "hot" : ""}" href="#/orders?s=${s}"><b>${cnt(s)}</b><span>${STATUSES[s]}</span></a>`; };
    setMain(h`${raw(flashHtml())}<h1>أهلاً ${me.name} 👋</h1>
      ${can(["admin", "operations"]) ? h`<div class="grid g4" style="margin-bottom:1rem">
        <div class="stat"><b>${d.today_orders || 0}</b><span>أوردرات النهاردة</span></div>
        <div class="stat"><b>${money(d.today_total)}</b><span>قيمة أوردرات النهاردة (ج.م)</span></div>
        <a class="stat ${d.need_payment ? "hot" : ""}" href="#/orders?s=active"><b>${d.need_payment || 0}</b><span>أوردرات منتظرة تأكيد دفع</span></a>
        <a class="stat ${d.out_count ? "hot" : ""}" href="#/stock?f=out"><b>${d.out_count || 0}</b><span>أصناف نفدت</span></a></div>` : ""}
      <div class="grid g4" style="margin-bottom:1rem">${["new", "preparing", "ready", "shipped", "delivered"].map(stat)}
        ${role !== "shipping" ? h`<a class="stat" href="#/orders?s=cancelled"><b>${cnt("cancelled")}</b><span>ملغي</span></a>` : ""}
        ${can(["admin", "operations", "shipping"]) ? h`<a class="stat" href="#/orders?s=returned"><b>${cnt("returned")}</b><span>مرتجع</span></a>` : ""}</div>
      <div class="card"><h2>${role === "warehouse" ? "أوردرات مطلوب تحضيرها" : role === "shipping" ? "أوردرات للشحن والتوصيل" : role === "sales" ? "آخر أوردراتي" : "آخر الأوردرات"}</h2>
        ${ordersTable(orders, role !== "sales")}<p class="small"><a href="#/orders">عرض كل الأوردرات ←</a></p></div>
      ${d.low_items && d.low_items.length ? h`<div class="card"><h2>⚠️ أصناف مخزونها قليل (${d.low_count})</h2><div class="tw"><table><tr><th>الصنف</th><th>الموديل</th><th>المتاح</th></tr>
        ${d.low_items.map(function (p) { return h`<tr><td>${p.name} ${p.brand}</td><td>${p.model}</td><td class="num"><span class="pill st-low">${p.avail}</span></td></tr>`; })}</table></div>
        <p class="small"><a href="#/stock?f=low">كل الأصناف القليلة ←</a></p></div>` : ""}`);
  }

  // ---------- المخزن ----------
  async function vStock(q) {
    var rows = await rpc("list_products", { p_q: q.q || "", p_cat: q.cat || "", p_flt: q.f || "" });
    var all = (q.q || q.cat || q.f) ? await rpc("list_products", {}) : rows;
    var tot = { n: 0, q: 0, r: 0 };
    all.forEach(function (p) { if (p.active) { tot.n++; tot.q += p.qty; tot.r += p.reserved; } });
    var adm = me.role === "admin", pr = can(PRICE);
    setMain(h`${raw(flashHtml())}<h1>المخزن</h1>
      <div class="grid g4" style="margin-bottom:1rem"><div class="stat"><b>${tot.n}</b><span>صنف</span></div><div class="stat"><b>${tot.q}</b><span>إجمالي القطع بالمخزن</span></div>
        <div class="stat"><b>${tot.r}</b><span>محجوز لأوردرات</span></div><div class="stat"><b>${tot.q - tot.r}</b><span>المتاح للبيع</span></div></div>
      <form class="bar" data-act="stock_filter"><input class="grow" name="q" value="${q.q || ""}" placeholder="ابحث باسم الصنف أو البراند أو الموديل...">
        <select name="cat"><option value="">كل الأقسام</option>${Object.keys(CATS).map(function (k) { return h`<option value="${k}" ${q.cat === k ? "selected" : ""}>${CATS[k]}</option>`; })}</select>
        <select name="f"><option value="">كل الحالات</option><option value="low" ${q.f === "low" ? "selected" : ""}>قليل</option><option value="out" ${q.f === "out" ? "selected" : ""}>نفد</option></select>
        <button class="btn sec">بحث</button>
        ${can(["admin", "operations", "warehouse"]) ? h`<button type="button" class="btn sec" data-click="export_stock">⬇ CSV</button>` : ""}
        ${adm ? h`<a class="btn" href="#/stock/new">+ صنف جديد</a>` : ""}</form>
      <div class="tw"><table><tr><th>القسم</th><th>الصنف</th><th>البراند / الوصف</th><th>الموديل / المقاس</th><th>بالمخزن</th><th>محجوز</th><th>المتاح</th><th>الحالة</th>${pr ? h`<th>السعر</th>` : ""}${adm ? h`<th>إضافة كمية</th><th></th>` : ""}</tr>
      ${rows.length ? rows.map(function (p) {
        var st = stState(p);
        return h`<tr ${p.active ? "" : raw('style="opacity:.5"')}><td class="small muted">${CATS[p.catalog]}</td><td><b>${p.name}</b>${p.active ? "" : h` <span class="pill s-cancelled">موقوف</span>`}</td><td>${p.brand}</td><td dir="auto">${p.model}</td>
          <td class="num">${p.qty}</td><td class="num muted">${p.reserved}</td><td class="num"><b>${p.qty - p.reserved}</b></td><td><span class="pill st-${st[0]}">${st[1]}</span></td>
          ${pr ? h`<td class="num">${p.price ? money(p.price) : "—"}</td>` : ""}
          ${adm ? h`<td><form class="qin" data-act="quick_receive" data-pid="${p.id}"><input type="number" name="qty" min="1" placeholder="+" required><button class="btn sm">إضافة</button></form></td><td><a class="small" href="#/stock/${p.id}">إدارة</a></td>` : ""}</tr>`;
      }) : h`<tr><td colspan="12" class="muted" style="text-align:center;padding:1.5rem">مفيش أصناف مطابقة</td></tr>`}</table></div>
      <p class="small muted">${rows.length} صنف معروض.${adm ? "" : " المخزن بيتعدّل من الأدمن فقط — الكميات بتتخصم تلقائياً لما الأوردر يخرج للشحن."}</p>`);
    view.rows = rows;
  }

  async function vProduct(id) {
    if (me.role !== "admin") return setMain(h`<div class="card"><div class="flash err">مش مسموح لحسابك بالصفحة دي.</div></div>`);
    var d = id ? await rpc("product_detail", { p_id: id }) : null, p = d ? d.product : { catalog: "PRO", name: "", brand: "", model: "", price: 0, min_qty: 3, qty: 0, active: true, reserved: 0 };
    var form = h`<form class="card" data-act="product_save" data-pid="${id || ""}"><h2>بيانات الصنف</h2>
      <label>القسم</label><select name="catalog">${Object.keys(CATS).map(function (k) { return h`<option value="${k}" ${p.catalog === k ? "selected" : ""}>${CATS[k]}</option>`; })}</select>
      <label>اسم الصنف</label><input name="name" value="${p.name}" required>
      <div class="row"><div><label>البراند / الوصف</label><input name="brand" value="${p.brand}"></div><div><label>الموديل / المقاس</label><input name="model" value="${p.model}"></div></div>
      <div class="row"><div><label>سعر البيع الافتراضي (ج.م)</label><input type="number" step="0.01" min="0" name="price" value="${p.price}"></div><div><label>حد التنبيه (المتاح ≤)</label><input type="number" min="0" name="min_qty" value="${p.min_qty}"></div></div>
      ${id ? h`<label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" name="active" style="width:auto" ${p.active ? "checked" : ""}> الصنف شغال (ظاهر للبيع)</label>` : h`<label>الكمية الابتدائية</label><input type="number" min="0" name="qty" value="0">`}
      <p><button class="btn">${id ? "حفظ" : "إضافة"}</button> <a class="btn sec" href="#/stock">رجوع</a></p></form>`;
    var side = id ? h`<div><div class="card"><h2>الرصيد الحالي</h2><div class="grid g4"><div class="stat"><b>${p.qty}</b><span>بالمخزن</span></div><div class="stat"><b>${p.reserved}</b><span>محجوز</span></div><div class="stat"><b>${p.qty - p.reserved}</b><span>المتاح</span></div></div></div>
      <form class="card" data-act="receive" data-pid="${id}"><h2>➕ إضافة كمية (استلام بضاعة)</h2><div class="row"><div><label>الكمية</label><input type="number" name="qty" min="1" required></div><div><label>ملاحظة (مورد / فاتورة)</label><input name="note"></div></div><p><button class="btn">إضافة للمخزن</button></p></form>
      <form class="card" data-act="adjust" data-pid="${id}"><h2>✏️ تعديل الرصيد (جرد)</h2><p class="small muted">اكتب الرصيد الفعلي اللي عدّيته، والسيستم هيسجل الفرق.</p><div class="row"><div><label>الرصيد الفعلي</label><input type="number" name="new_qty" min="${p.reserved}" required></div><div><label>السبب</label><input name="note" required placeholder="جرد / تالف / فرق عدّ"></div></div><p><button class="btn org">تعديل الرصيد</button></p></form></div>` : "";
    var hist = id ? h`<div class="card"><h2>سجل حركة الصنف</h2><div class="tw"><table><tr><th>الوقت</th><th>النوع</th><th>التغيير</th><th>الرصيد بعد</th><th>ملاحظة</th><th>بواسطة</th></tr>
      ${d.moves.map(function (r) { return h`<tr><td class="small">${dt(r.created_at)}</td><td>${MOVE[r.kind]}</td><td class="num" dir="ltr">${(r.qty_change > 0 ? "+" : "") + r.qty_change}</td><td class="num">${r.qty_after}</td><td class="small">${r.order_id ? h`<a href="#/orders/${r.order_id}">${ono(r.order_id)}</a> ` : ""}${r.note}</td><td class="small">${r.uname || ""}</td></tr>`; })}</table></div></div>` : "";
    setMain(h`${raw(flashHtml())}<h1>${id ? "إدارة الصنف: " + p.name + " " + p.model : "إضافة صنف جديد"}</h1><div class="grid g2">${form}${side}</div>${hist}`);
  }

  async function vMovements() {
    var rows = await rpc("list_movements");
    setMain(h`<h1>حركة المخزن (آخر 300)</h1><div class="tw"><table><tr><th>الوقت</th><th>الصنف</th><th>النوع</th><th>التغيير</th><th>الرصيد بعد</th><th>ملاحظة</th><th>بواسطة</th></tr>
      ${rows.map(function (r) { return h`<tr><td class="small">${dt(r.created_at)}</td><td><a href="#/stock/${r.product_id}">${r.name} ${r.brand} ${r.model}</a></td><td>${MOVE[r.kind]}</td><td class="num" dir="ltr">${(r.qty_change > 0 ? "+" : "") + r.qty_change}</td><td class="num">${r.qty_after}</td><td class="small">${r.order_id ? h`<a href="#/orders/${r.order_id}">${ono(r.order_id)}</a> ` : ""}${r.note}</td><td class="small">${r.uname || ""}</td></tr>`; })}</table></div>`);
  }

  // ---------- الأوردرات ----------
  async function vOrders(q) {
    var st = q.s || "", rows = await rpc("list_orders", { p_status: st, p_q: q.q || "", p_limit: 300 });
    var tabs = me.role === "shipping" ? ["active", "ready", "shipped", "delivered", "returned"] : ["active"].concat(Object.keys(STATUSES));
    setMain(h`${raw(flashHtml())}<h1>الأوردرات</h1><div class="tabs"><a href="#/orders${q.q ? "?q=" + encodeURIComponent(q.q) : ""}" class="${st ? "" : "on"}">الكل</a>
      ${tabs.map(function (t) { return h`<a href="#/orders?s=${t}${q.q ? "&q=" + encodeURIComponent(q.q) : ""}" class="${st === t ? "on" : ""}">${t === "active" ? "شغّالة" : STATUSES[t]}</a>`; })}</div>
      <form class="bar" data-act="orders_filter"><input type="hidden" name="s" value="${st}"><input class="grow" name="q" value="${q.q || ""}" placeholder="رقم الأوردر أو اسم العميل أو التليفون...">
        <button class="btn sec">بحث</button>${can(["sales", "admin"]) ? h`<a class="btn" href="#/orders/new">+ أوردر جديد</a>` : ""}</form>
      ${ordersTable(rows, me.role !== "sales")}`);
  }

  async function vOrderNew() {
    if (!can(["sales", "admin"])) return setMain(h`<div class="card"><div class="flash err">مش مسموح لحسابك بالصفحة دي.</div></div>`);
    products = (await rpc("list_products", {})).filter(function (p) { return p.active; }).map(function (p) {
      return { id: p.id, label: [p.name, p.brand, p.model].filter(Boolean).join(" | "), avail: p.qty - p.reserved, price: p.price || 0 };
    });
    setMain(h`${raw(flashHtml())}<h1>أوردر جديد</h1><form id="orderform" data-act="create_order">
      <div class="grid g2"><div class="card"><h2>بيانات العميل</h2>
        <label>اسم العميل / الشركة *</label><input name="customer_name" required>
        <div class="row"><div><label>التليفون *</label><input name="phone" inputmode="tel" dir="ltr" required></div><div><label>تليفون تاني</label><input name="phone2" inputmode="tel" dir="ltr"></div></div>
        <label>المحافظة</label><input name="governorate"><label>العنوان بالتفصيل *</label><textarea name="address" required></textarea><label>ملاحظات للمخزن / الشحن</label><textarea name="notes"></textarea></div>
      <div class="card"><h2>الدفع</h2><label>طريقة الدفع *</label><select name="payment_type" id="payment_type">${Object.keys(PAY).map(function (k) { return h`<option value="${k}">${PAY[k]}</option>`; })}</select>
        <div id="depbox" class="hide"><label>قيمة العربون (ج.م)</label><input type="number" step="0.01" min="0" name="deposit_amount" id="deposit_amount"></div>
        <label>مصاريف الشحن (ج.م)</label><input type="number" step="0.01" min="0" name="shipping_fee" id="shipping_fee" value="0">
        <p class="small muted">العربون والدفع الكامل بتأكدهم العمليات قبل خروج الأوردر. الأوردر بيروح للمخزن فوراً بعد الإرسال.</p>
        <div style="margin-top:1rem">إجمالي الأصناف: <b id="subtotal">0</b> ج.م<br>الإجمالي بالشحن: <span class="total" id="grand">0</span> ج.م</div></div></div>
      <div class="card"><h2>الأصناف</h2><div class="relp" id="picker"><input id="psearch" placeholder="🔍 ابحث عن صنف (اسم / موديل / مقاس) واختاره..." autocomplete="off"><div class="results hide" id="presults"></div></div>
        <div class="line small muted" style="border-bottom:2px solid var(--line);margin-top:.6rem"><div>الصنف</div><div>الكمية</div><div>السعر</div><div class="lt">الإجمالي</div><div></div></div>
        <div id="lines"></div><p class="muted" id="nolines">لسه ماضفتش أصناف.</p></div>
      <p><button class="btn lg">📤 إرسال الأوردر للمخزن</button> <a class="btn sec lg" href="#/orders">إلغاء</a></p></form>`);
    initPicker();
  }

  function initPicker() {
    var q = $("#psearch"), res = $("#presults"), lines = $("#lines"), fee = $("#shipping_fee"), ptype = $("#payment_type"), depbox = $("#depbox"), added = {};
    function showRes() {
      var words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return res.classList.add("hide");
      var out = products.filter(function (p) { var l = p.label.toLowerCase(); return words.every(function (w) { return l.indexOf(w) > -1; }); }).slice(0, 12);
      res.innerHTML = "";
      out.forEach(function (p) {
        var b = document.createElement("button"); b.type = "button"; b.disabled = p.avail <= 0 || !!added[p.id];
        b.innerHTML = "<span></span><b></b>"; b.children[0].textContent = p.label; b.children[1].textContent = p.avail <= 0 ? "نفد" : "متاح " + p.avail;
        b.onclick = function () { addLine(p); q.value = ""; res.classList.add("hide"); q.focus(); };
        res.appendChild(b);
      });
      if (!out.length) res.innerHTML = '<div class="muted" style="padding:.7rem">مفيش نتيجة</div>';
      res.classList.remove("hide");
    }
    q.addEventListener("input", showRes); q.addEventListener("focus", showRes);
    function addLine(p) {
      if (added[p.id]) return; added[p.id] = 1;
      var d = document.createElement("div"); d.className = "line"; d.dataset.pid = p.id;
      d.innerHTML = '<div class="nm"><span></span><small></small></div><input type="number" class="lq" min="1" step="1" required><input type="number" class="lp" min="0" step="0.01" required><div class="lt num"></div><button type="button" class="x" title="حذف">×</button>';
      d.querySelector(".nm span").textContent = p.label; d.querySelector("small").textContent = "المتاح: " + p.avail;
      var qi = d.querySelector(".lq"), pi = d.querySelector(".lp"), lt = d.querySelector(".lt");
      qi.max = p.avail; qi.value = 1; pi.value = p.price || 0;
      function upd() { var v = Math.max(0, +qi.value || 0) * Math.max(0, +pi.value || 0); lt.textContent = money(v); lt.dataset.v = v; recalc(); }
      qi.oninput = pi.oninput = upd; d.querySelector(".x").onclick = function () { delete added[p.id]; d.remove(); recalc(); };
      lines.appendChild(d); upd();
    }
    function recalc() {
      var s = 0; lines.querySelectorAll(".lt").forEach(function (e) { s += +e.dataset.v || 0; });
      $("#subtotal").textContent = money(s); $("#grand").textContent = money(s + Math.max(0, +fee.value || 0));
      $("#nolines").classList.toggle("hide", lines.children.length > 0);
    }
    fee.addEventListener("input", recalc);
    function pt() { depbox.classList.toggle("hide", ptype.value !== "deposit"); $("#deposit_amount").required = ptype.value === "deposit"; }
    ptype.addEventListener("change", pt); pt();
  }

  async function vOrder(id) {
    var g = await rpc("get_order", { p_id: id }), o = g.order, A = g.actions, pr = can(PRICE), ct = can(CONTACT);
    var has = function (a) { return A.indexOf(a) > -1; };
    var f = function (name, inner, confirmMsg) { return h`<form data-act="order_action" data-oid="${id}" data-name="${name}" ${confirmMsg ? raw('data-confirm="' + esc(confirmMsg) + '"') : ""}>${inner}</form>`; };
    setMain(h`${raw(flashHtml())}<div class="bar"><h1 style="margin:0">${ono(id)}</h1>${spill(o.status)}<span class="muted small">أنشأه ${o.seller} · ${dt(o.created_at)}</span><span style="flex:1"></span><a class="btn sec sm" href="#/orders">← الأوردرات</a></div>
      ${o.payment_type !== "cod" && !o.payment_confirmed && ["new", "preparing", "ready"].indexOf(o.status) > -1 && me.role !== "warehouse" ? h`<div class="warnbox">💰 الدفع (${PAY[o.payment_type]}) لسه متأكدش من العمليات — الأوردر مش هيخرج للتوصيل قبل التأكيد.</div>` : ""}
      ${o.status === "returned" && !o.restocked ? h`<div class="warnbox">↩️ الأوردر مرتجع — الكميات لسه ماتضافتش للمخزن (الأدمن بيرجّعها).</div>` : ""}
      <div class="grid g2"><div class="card"><h2>العميل والتوصيل</h2><dl class="kv"><dt>الاسم</dt><dd>${o.customer_name}</dd>
        ${ct ? h`<dt>التليفون</dt><dd dir="ltr" style="text-align:${BT_I18N.lang === 'ar' ? 'right' : 'left'}"><a href="tel:${o.phone}">${o.phone}</a>${o.phone2 ? h` · <a href="tel:${o.phone2}">${o.phone2}</a>` : ""}</dd><dt>المحافظة</dt><dd>${o.governorate || "—"}</dd><dt>العنوان</dt><dd>${o.address}</dd>` : ""}
        <dt>ملاحظات</dt><dd>${o.notes || "—"}</dd></dl></div>
      ${pr || me.role === "shipping" ? h`<div class="card"><h2>الدفع</h2><dl class="kv"><dt>الطريقة</dt><dd>${PAY[o.payment_type]}</dd>
        ${pr ? h`<dt>إجمالي الأصناف</dt><dd>${money(o.subtotal)} ج.م</dd><dt>الشحن</dt><dd>${money(o.shipping_fee)} ج.م</dd><dt>الإجمالي</dt><dd><b>${money(o.total)} ج.م</b></dd>` : ""}
        ${o.payment_type === "deposit" ? h`<dt>العربون</dt><dd>${money(o.deposit_amount)} ج.م</dd>` : ""}
        ${o.payment_type !== "cod" ? h`<dt>تأكيد الدفع</dt><dd>${o.payment_confirmed ? "✅ اتأكد " + money(o.paid_amount) + " ج.م" : "⏳ لسه"}</dd>` : ""}
        <dt>مطلوب تحصيله عند التسليم</dt><dd><span class="total">${money(g.due)}</span> ج.م</dd>
        ${o.collected_amount != null ? h`<dt>اتحصّل فعلاً</dt><dd>${money(o.collected_amount)} ج.م</dd>` : ""}</dl></div>` : ""}</div>
      <div class="card"><h2>الأصناف</h2><div class="tw"><table><tr><th>الصنف</th><th>الكمية</th>${pr ? h`<th>السعر</th><th>الإجمالي</th>` : ""}${can(["warehouse", "admin"]) ? h`<th>رصيد المخزن</th>` : ""}</tr>
        ${g.items.map(function (i) { return h`<tr><td>${i.label}</td><td class="num"><b>${i.qty}</b></td>${pr ? h`<td class="num">${money(i.unit_price)}</td><td class="num">${money(i.qty * i.unit_price)}</td>` : ""}${can(["warehouse", "admin"]) ? h`<td class="num muted">${i.p_qty}</td>` : ""}</tr>`; })}</table></div></div>
      <div class="card"><h2>الإجراءات</h2><div class="actions">
        ${has("start_prepare") ? f("start_prepare", h`<button class="btn org">🔧 بدء التحضير</button>`) : ""}
        ${has("mark_ready") ? f("mark_ready", h`<button class="btn">📦 تم التجهيز — جاهز للشحن</button>`) : ""}
        ${has("ship") ? f("ship", h`<button class="btn">🚚 استلمت الشحنة — خرج للتوصيل</button>`, "تأكيد خروج الأوردر من المخزن للتوصيل؟ هيتخصم من المخزن.") : ""}
        ${has("deliver") ? f("deliver", h`<input type="number" step="0.01" min="0" name="collected" value="${g.due}" title="المبلغ المحصّل"><button class="btn">✅ تم التسليم والتحصيل</button>`) : ""}
        ${has("return") ? f("return", h`<input type="text" name="reason" placeholder="سبب الرجوع" required><button class="btn red">↩️ مرتجع</button>`) : ""}
        ${has("confirm_payment") && !o.payment_confirmed ? f("confirm_payment", h`<input type="number" step="0.01" min="0" name="amount" value="${o.payment_type === "deposit" ? o.deposit_amount : o.total}" title="المبلغ المستلم"><button class="btn">💰 تأكيد استلام الدفع</button>`) : ""}
        ${has("cancel") ? f("cancel", h`<input type="text" name="reason" placeholder="سبب الإلغاء" required><button class="btn red">❌ إلغاء الأوردر</button>`, "إلغاء الأوردر؟") : ""}
        ${has("restock") ? f("restock", h`<button class="btn org">📥 إرجاع الكميات للمخزن</button>`, "إرجاع كميات الأوردر للمخزن؟") : ""}</div>
        ${A.length <= 1 ? h`<p class="muted small">مفيش إجراءات متاحة لحسابك في الحالة دي.</p>` : ""}
        ${has("edit_customer") ? h`<details style="margin-top:1rem"><summary style="cursor:pointer;color:var(--brand);font-weight:600">✏️ تعديل بيانات العميل والعنوان</summary>
          ${f("edit_customer", h`<div class="row"><div><label>الاسم</label><input name="customer_name" value="${o.customer_name}" required></div><div><label>التليفون</label><input name="phone" value="${o.phone}" dir="ltr" required></div>
          <div><label>تليفون تاني</label><input name="phone2" value="${o.phone2}" dir="ltr"></div><div><label>المحافظة</label><input name="governorate" value="${o.governorate}"></div></div>
          <label>العنوان</label><textarea name="address" required>${o.address}</textarea><label>ملاحظات</label><textarea name="notes">${o.notes}</textarea><p><button class="btn">حفظ التعديل</button></p>`)}</details>` : ""}</div>
      <div class="card"><h2>الملاحظات وسجل الأوردر</h2><form class="bar" data-act="order_action" data-oid="${id}" data-name="note"><input class="grow" name="text" placeholder="أضف ملاحظة للفريق..." required><button class="btn sec">إضافة</button></form>
        <ul class="tl">${g.logs.map(function (l) { return h`<li><b>${LOGI[l.action] || l.action}</b> — ${l.detail}<div class="t">${l.uname || "—"} (${l.urole ? ROLES[l.urole] : ""}) · ${dt(l.created_at)}</div></li>`; })}</ul></div>`);
  }

  // ---------- الحسابات ----------
  async function vUsers() {
    if (me.role !== "admin") return setMain(h`<div class="card"><div class="flash err">مش مسموح لحسابك بالصفحة دي.</div></div>`);
    var rows = await rpc("list_users");
    setMain(h`${raw(flashHtml())}<h1>الحسابات</h1>
      <form class="card" data-act="create_user"><h2>➕ إنشاء حساب جديد</h2>
        <div class="row"><div><label>اسم الموظف</label><input name="name" required></div><div><label>الإيميل</label><input type="email" name="email" required dir="ltr" autocomplete="off"></div></div>
        <div class="row"><div><label>الباسورد (8 على الأقل)</label><input type="text" name="password" required minlength="8" dir="ltr" autocomplete="off"></div>
        <div><label>الدور</label><select name="role">${Object.keys(ROLES).filter(function (r) { return r !== "none"; }).map(function (r) { return h`<option value="${r}" ${r === "sales" ? "selected" : ""}>${ROLES[r]}</option>`; })}</select></div></div>
        <p class="small muted">الموظف يقدر يدخل بالإيميل والباسورد ده فوراً. الدور هو اللي بيحدد هيشوف إيه وهيعمل إيه (الصلاحيات تحت).</p>
        <p><button class="btn">اعمل الحساب</button></p></form>
      <div class="tw"><table><tr><th>الاسم</th><th>الإيميل</th><th>الدور</th><th>الحالة</th><th></th></tr>
      ${rows.map(function (u) { return h`<tr ${u.active ? "" : raw('style="opacity:.55"')}><td><b>${u.name}</b></td><td dir="ltr" style="text-align:${BT_I18N.lang === 'ar' ? 'right' : 'left'}">${u.email}</td><td><span class="pill ${u.role === "none" ? "s-preparing" : "s-new"}">${ROLES[u.role]}</span></td><td>${u.active ? "شغال" : h`<span class="pill s-cancelled">موقوف</span>`}</td>
        <td><details><summary style="cursor:pointer;color:var(--brand)">تعديل</summary><form data-act="set_user" data-uid="${u.id}" style="min-width:260px"><label>الاسم</label><input name="name" value="${u.name}" required>
        <label>الدور</label><select name="role">${Object.keys(ROLES).map(function (r) { return h`<option value="${r}" ${u.role === r ? "selected" : ""}>${ROLES[r]}</option>`; })}</select>
        <label style="display:flex;gap:.5rem;align-items:center"><input type="checkbox" name="active" style="width:auto" ${u.active ? "checked" : ""}> الحساب شغال</label><p><button class="btn sm">حفظ</button></p></form>
        <form data-act="reset_pw" data-uid="${u.id}" style="min-width:260px;margin-top:.6rem"><label>تغيير باسورد الموظف</label><input type="text" name="password" required minlength="8" dir="ltr" placeholder="باسورد جديد (8 على الأقل)" autocomplete="off"><p><button class="btn sm sec">تغيير الباسورد</button></p></form></details></td></tr>`; })}</table></div>
      <div class="card" style="margin-top:1rem"><h2>الصلاحيات</h2><ul class="small"><li><b>الأدمن:</b> كل حاجة — الوحيد اللي بيضيف/يعدّل المخزن والأصناف والحسابات.</li><li><b>السيلز:</b> يعمل أوردرات ويتابع أوردراته هو بس، ويشوف المتاح بالمخزن (قراءة فقط).</li><li><b>العمليات:</b> يتابع كل الأوردرات، يأكد العربون/الدفع، يعدّل بيانات العميل، يلغي أوردر.</li><li><b>المخزن:</b> بيتبلّغ فوراً بأي أوردر جديد، يحضّره ويجهّزه (من غير أسعار)، ويشوف الأرصدة قراءة فقط.</li><li><b>الشحن:</b> يشوف الأوردرات الجاهزة، يستلمها، يسلّمها ويحصّل، أو يسجّلها مرتجع.</li></ul></div>`);
  }

  async function vNotifs() {
    var rows = await rpc("notifs_list"); setBadge(0);
    setMain(h`<h1>🔔 الإشعارات</h1><div class="card">${rows.length ? rows.map(function (r) {
      return h`<div class="${r.is_new ? "unread" : ""}" style="padding:.6rem .4rem;border-bottom:1px solid var(--line)">${r.order_id ? h`<a href="#/orders/${r.order_id}">${r.message}</a>` : r.message}<div class="small muted">${dt(r.created_at)}</div></div>`;
    }) : h`<p class="muted">مفيش إشعارات.</p>`}</div>`);
  }

  function vPassword() {
    setMain(h`${raw(flashHtml())}<div style="max-width:440px;margin:auto"><h1>تغيير الباسورد</h1><form class="card" data-act="password">
      <label>الباسورد الجديد (8 على الأقل)</label><input type="password" name="new" required minlength="8" dir="ltr" autocomplete="new-password">
      <label>تأكيد الباسورد الجديد</label><input type="password" name="new2" required minlength="8" dir="ltr" autocomplete="new-password"><p><button class="btn">حفظ</button></p></form></div>`);
  }

  // ---------- الأحداث ----------
  var HANDLERS = {
    login: async function (f, d) {
      var r = await sb.auth.signInWithPassword({ email: d.get("email").trim(), password: d.get("password") });
      if (r.error) return loginView("الإيميل أو الباسورد غلط.");
      await boot();
    },
    stock_filter: function (f, d) {
      var p = new URLSearchParams(); ["q", "cat", "f"].forEach(function (k) { if (d.get(k)) p.set(k, d.get(k)); });
      go("#/stock" + (p.toString() ? "?" + p : ""));
    },
    orders_filter: function (f, d) {
      var p = new URLSearchParams(); ["s", "q"].forEach(function (k) { if (d.get(k)) p.set(k, d.get(k)); });
      go("#/orders" + (p.toString() ? "?" + p : ""));
    },
    quick_receive: async function (f, d) {
      var pid = +f.dataset.pid; var r = await rpc("stock_receive", { p_id: pid, p_qty: +d.get("qty"), p_note: "إضافة سريعة" });
      flash("تمت الإضافة — الرصيد دلوقتي " + r.qty_after + "."); route();
    },
    receive: async function (f, d) {
      var r = await rpc("stock_receive", { p_id: +f.dataset.pid, p_qty: +d.get("qty"), p_note: d.get("note") || "" });
      flash("تمت الإضافة — الرصيد دلوقتي " + r.qty_after + "."); route();
    },
    adjust: async function (f, d) {
      await rpc("stock_adjust", { p_id: +f.dataset.pid, p_new_qty: +d.get("new_qty"), p_note: d.get("note") }); flash("تم تعديل الرصيد."); route();
    },
    product_save: async function (f, d) {
      var pid = f.dataset.pid ? +f.dataset.pid : null;
      var p = { id: pid, catalog: d.get("catalog"), name: d.get("name"), brand: d.get("brand"), model: d.get("model"), price: d.get("price"), min_qty: d.get("min_qty"), qty: d.get("qty") || 0, active: pid ? d.get("active") === "on" : true };
      var id = await rpc("product_save", { p: p }); flash(pid ? "تم حفظ بيانات الصنف." : "تمت إضافة الصنف."); go("#/stock/" + id);
    },
    create_order: async function (f, d) {
      var items = []; document.querySelectorAll("#lines .line").forEach(function (l) { items.push({ product_id: +l.dataset.pid, qty: +l.querySelector(".lq").value, price: +l.querySelector(".lp").value }); });
      if (!items.length) throw new Error("ضيف صنف واحد على الأقل للأوردر.");
      var p = { customer_name: d.get("customer_name"), phone: d.get("phone"), phone2: d.get("phone2"), governorate: d.get("governorate"), address: d.get("address"), notes: d.get("notes"),
        payment_type: d.get("payment_type"), deposit_amount: d.get("deposit_amount") || 0, shipping_fee: d.get("shipping_fee") || 0, items: items };
      var id = await rpc("create_order", { p: p }); flash("تم إرسال الأوردر " + ono(id) + " للمخزن."); go("#/orders/" + id);
    },
    order_action: async function (f, d) {
      var payload = {}; d.forEach(function (v, k) { payload[k] = v; });
      var msg = await rpc("order_action", { p_id: +f.dataset.oid, p_action: f.dataset.name, p: payload }); flash(msg); route();
    },
    create_user: async function (f, d) {
      await callFn({ action: "create", name: d.get("name"), email: d.get("email"), password: d.get("password"), role: d.get("role") });
      flash("تم إنشاء الحساب."); route();
    },
    reset_pw: async function (f, d) {
      await callFn({ action: "reset_password", id: f.dataset.uid, password: d.get("password") });
      flash("تم تغيير الباسورد."); route();
    },
    set_user: async function (f, d) {
      await rpc("set_user", { p_id: f.dataset.uid, p_name: d.get("name"), p_role: d.get("role"), p_active: d.get("active") === "on" }); flash("تم حفظ الحساب."); route();
    },
    password: async function (f, d) {
      if (d.get("new") !== d.get("new2")) throw new Error("الباسوردين مش متطابقين.");
      var r = await sb.auth.updateUser({ password: d.get("new") }); if (r.error) throw new Error(r.error.message);
      flash("تم تغيير الباسورد."); go("#/");
    }
  };
  document.addEventListener("submit", async function (e) {
    var f = e.target.closest("form[data-act]"); if (!f) return; e.preventDefault();
    if (f.dataset.confirm && !window.confirm(f.dataset.confirm)) return;
    var btn = f.querySelector("button:not([type=button])"); if (btn) btn.disabled = true;
    try { await HANDLERS[f.dataset.act](f, new FormData(f)); }
    catch (err) { if (btn) btn.disabled = false; showErr(err.message); }
  });
  function showErr(msg) {
    flash(msg, "err"); var m = $("#main"); var old = m.querySelector(".flash.err"); if (old) old.remove();
    var d = document.createElement("div"); d.className = "flash err"; d.textContent = msg; m.insertBefore(d, m.firstChild); flashMsg = null; window.scrollTo(0, 0);
  }
  document.addEventListener("click", async function (e) {
    var b = e.target.closest("[data-click]"); if (!b) return; var a = b.dataset.click;
    if (a === "logout") { await sb.auth.signOut(); me = null; loginView(); }
    else if (a === "reload") boot();
    else if (a === "lang") BT_I18N.set(BT_I18N.lang === "en" ? "ar" : "en");
    else if (a === "export_stock") exportStock();
  });
  function exportStock() {
    var rows = view.rows || []; var lines = ["القسم,الصنف,البراند,الموديل,بالمخزن,محجوز,المتاح"];
    rows.forEach(function (p) { lines.push([CATS[p.catalog], p.name, p.brand, p.model, p.qty, p.reserved, p.qty - p.reserved].map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(",")); });
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + BT_I18N.tr(lines.join("\n"))], { type: "text/csv;charset=utf-8" })); a.download = "stock.csv"; a.click();
  }

  // ---------- الإشعارات اللحظية ----------
  var audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [880, 1175].forEach(function (f, i) { var o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
        var t = audioCtx.currentTime + i * 0.18; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17); o.start(t); o.stop(t + 0.18); });
    } catch (e) {}
  }
  document.addEventListener("click", function () { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) {} }, { once: true });
  function toast(ev) {
    var d = document.createElement("div"); d.className = "toast" + (ev.kind === "order_new" ? " big" : ""); d.textContent = ev.message;
    d.onclick = function () { location.hash = ev.order_id ? "#/orders/" + ev.order_id : "#/notifications"; d.remove(); };
    $("#toasts").appendChild(d); setTimeout(function () { d.remove(); }, 12000);
  }
  function typing() { var a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && $("#main").contains(a); }
  var polling = false;
  async function poll() {
    if (!me || me.role === "none" || polling) return; polling = true;
    try {
      var r = await rpc("notifs_since", { p_after: lastNotif });
      if (r.events.length) {
        r.events.forEach(function (e) { lastNotif = Math.max(lastNotif, e.id); toast(e); }); beep();
        if (LIVE[view.name] && !typing()) route();
      }
      setBadge(r.unread);
    } catch (e) {} finally { polling = false; }
  }
  function startLive() {
    if (window.__btTimer) return;
    window.__btTimer = setInterval(poll, 6000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
    try {   // Realtime: إشعار في نفس اللحظة. لو فشل، الـ polling شغال احتياطي
      sb.channel("notifs").on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, function () { poll(); }).subscribe();
    } catch (e) {}
  }

  // ---------- التشغيل ----------
  async function boot() {
    var s = await sb.auth.getSession();
    if (!s.data.session) { me = null; return loginView(); }
    try { me = await rpc("my_profile"); } catch (e) { me = null; }
    if (!me) { await sb.auth.signOut(); return loginView("الحساب مش مفعّل."); }
    lastNotif = me.max_notif || 0;
    startLive();
    route();
  }
  window.addEventListener("hashchange", function () { if (me) route(); });
  if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.indexOf("YOUR-PROJECT") > -1) {
    setMain('<div class="card" style="max-width:520px;margin:10vh auto"><h2>لسه محتاج إعداد</h2><p>افتح الملف <b>config.js</b> وحط رابط ومفتاح مشروع Supabase بتاعك.</p></div>');
  } else {
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    boot();
  }
})();
