const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─── Supabase config ──────────────────────────────────────────────────────────
const SUPA_URL = "https://piipxpxsnibwcorldgru.supabase.co";
const SUPA_KEY = "sb_publishable_yf1nxJmLG81YlIDlu_rtvA_nJfBrcXl";
const SUPA_SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpaXB4cHhzbmlid2NvcmxkZ3J1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjEyNjc3OSwiZXhwIjoyMDg3NzAyNzc5fQ.ggJk90wyvKfkR7AGGNO9AOQMCrqC62Gq47J5KeTG3f8";

const H = {
  "Content-Type": "application/json",
  "apikey": SUPA_KEY,
  "Authorization": "Bearer " + SUPA_KEY,
};
const HS = { // service role for writes
  "Content-Type": "application/json",
  "apikey": SUPA_SERVICE,
  "Authorization": "Bearer " + SUPA_SERVICE,
  "Prefer": "resolution=merge-duplicates,return=representation",
};

// ─── Generic REST helpers ─────────────────────────────────────────────────────
async function sbGet(table, params = "") {
  const r = await fetch(`${SUPA_URL}/rest/v1/${table}?${params}`, { headers: H });
  if (!r.ok) { console.error("GET", table, await r.text()); return null; }
  return r.json();
}
async function sbPost(table, body) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: "POST", headers: HS, body: JSON.stringify(body)
  });
  if (!r.ok) { console.error("POST", table, await r.text()); return false; }
  return true;
}
async function sbPatch(table, filter, body) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH", headers: HS, body: JSON.stringify(body)
  });
  if (!r.ok) { console.error("PATCH", table, await r.text()); return false; }
  return true;
}
async function sbDelete(table, filter) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${table}?${filter}`, {
    method: "DELETE", headers: HS
  });
  if (!r.ok) { console.error("DELETE", table, await r.text()); return false; }
  return true;
}
async function sbUpsert(table, body) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...HS, "Prefer": "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(body)
  });
  if (!r.ok) { console.error("UPSERT", table, await r.text()); return false; }
  return true;
}

// ─── Legacy fab_storage (read-only for migration) ─────────────────────────────
const legacyDb = {
  async get(k) {
    try {
      const r = await fetch(SUPA_URL + "/rest/v1/fab_storage?key=eq." + encodeURIComponent(k) + "&select=value", { headers: H });
      if (!r.ok) return null;
      const d = await r.json();
      return d && d.length ? JSON.parse(d[0].value) : null;
    } catch (e) { return null; }
  }
};

// ─── New granular DB layer ────────────────────────────────────────────────────
const db = {
  // ── Users ──
  async getUsers() {
    return await sbGet("users", "select=*&order=name.asc") || [];
  },
  async upsertUser(user) {
    return sbUpsert("users", {
      id: user.id, username: user.username, password: user.password,
      role: user.role, name: user.name, token: user.token
    });
  },
  async deleteUser(id) { return sbDelete("users", `id=eq.${id}`); },

  // ── Clients ──
  async getClients() {
    return await sbGet("clients", "select=*&order=name.asc") || [];
  },
  async upsertClient(c) {
    return sbUpsert("clients", {
      id: c.id, name: c.name, contact: c.contact || null,
      publicidad: !!c.publicidad, extra: c.extra || null
    });
  },
  async deleteClient(id) { return sbDelete("clients", `id=eq.${id}`); },

  // ── Providers ──
  async getProviders() {
    return await sbGet("providers", "select=*&order=name.asc") || [];
  },
  async upsertProvider(p) {
    return sbUpsert("providers", {
      id: p.id, name: p.name, contact: p.contact || null,
      lead_days: p.leadDays || 0
    });
  },
  async deleteProvider(id) { return sbDelete("providers", `id=eq.${id}`); },

  // ── Catalog ──
  async getCatalog() {
    return (await sbGet("catalog_items", "select=*&order=tipo.asc,linea.asc,articulo.asc") || [])
      .map(dbCatalogToApp);
  },
  async upsertCatalogItem(item) {
    return sbUpsert("catalog_items", {
      id: item.id, tipo: item.tipo || null, linea: item.linea || null,
      articulo: item.articulo, ref: item.ref || null,
      steps: item.steps || {}, step_settings: item.stepSettings || {},
      files: item.files || []
    });
  },
  async deleteCatalogItem(id) { return sbDelete("catalog_items", `id=eq.${id}`); },

  // ── Orders (header only) ──
  async getOrders() {
    const orders = await sbGet("orders", "select=*&order=created_at.desc") || [];
    return orders.map(dbOrderToApp);
  },
  async upsertOrderHeader(order) {
    return sbUpsert("orders", {
      id: order.id,
      number: order.number,
      client: order.client,
      client_id: order.clientId || null,
      client_contact: order.clientContact || null,
      client_publicidad: !!order.clientPublicidad,
      ref: order.ref || null,
      date_start: order.dateStart || null,
      date_end: order.dateEnd || null,
      released: !!order.released,
      archived: !!order.archived,
      assigned_users: order.assignedUsers || [],
      files: order.files || [],
      created_at: order.createdAt || new Date().toISOString(),
    });
  },
  async deleteOrder(id) { return sbDelete("orders", `id=eq.${id}`); },
  async patchOrder(id, fields) { return sbPatch("orders", `id=eq.${id}`, fields); },

  // ── Order comments ──
  async getOrderComments(orderId) {
    return await sbGet("order_comments", `order_id=eq.${orderId}&order=ts.asc`) || [];
  },
  async addOrderComment(comment) {
    return sbPost("order_comments", {
      id: comment.id, order_id: comment.orderId,
      author: comment.author, role: comment.role,
      text: comment.text, ts: comment.ts
    });
  },

  // ── Order items ──
  async getOrderItems(orderId) {
    return await sbGet("order_items", `order_id=eq.${orderId}&order=position.asc`) || [];
  },
  async upsertOrderItem(item, orderId, position) {
    return sbUpsert("order_items", {
      id: item.id, order_id: orderId,
      name: item.name || null, catalog_ref: item.catalogRef || null,
      catalog_id: item.catalogId || null, position
    });
  },
  async deleteOrderItem(id) { return sbDelete("order_items", `id=eq.${id}`); },

  // ── Item steps ──
  async getItemSteps(itemId) {
    return await sbGet("item_steps", `item_id=eq.${itemId}&order=step_key.asc`) || [];
  },
  async upsertItemStep(step) {
    return sbUpsert("item_steps", {
      id: step.id,
      item_id: step.itemId,
      step_key: step.stepKey,
      enabled: !!step.enabled,
      done: !!step.done,
      date_start: step.dateStart || null,
      date_end: step.date || null,
      done_at: step.doneAt || null,
      total_seconds: step.totalSeconds || 0,
      running: !!step.running,
      start_ts: step.startTs || null,
      what: step.what || null,
      order_num: step.orderNum || null,
      checks: step.checks || {},
      photos: step.photos || [],
      files: step.files || [],
      updated_at: new Date().toISOString(),
    });
  },
  // Granular timer update — only touches timer fields
  async patchStepTimer(stepId, { totalSeconds, running, startTs }) {
    return sbPatch("item_steps", `id=eq.${stepId}`, {
      total_seconds: totalSeconds,
      running: !!running,
      start_ts: startTs || null,
      updated_at: new Date().toISOString(),
    });
  },
  // Granular done toggle
  async patchStepDone(stepId, done, doneAt) {
    return sbPatch("item_steps", `id=eq.${stepId}`, {
      done: !!done,
      done_at: doneAt || null,
      updated_at: new Date().toISOString(),
    });
  },

  // ── Time logs ──
  async getTimeLogs(itemStepId) {
    return await sbGet("step_time_logs", `item_step_id=eq.${itemStepId}&order=start_ts.asc`) || [];
  },
  async addTimeLog(log) {
    return sbPost("step_time_logs", {
      id: log.id, item_step_id: log.itemStepId,
      author: log.author, start_ts: log.startTs,
      stop_ts: log.stopTs || null, secs: log.secs || 0
    });
  },

  // ── Step comments ──
  async getStepComments(itemStepId) {
    return await sbGet("step_comments", `item_step_id=eq.${itemStepId}&order=ts.asc`) || [];
  },
  async addStepComment(comment) {
    return sbPost("step_comments", {
      id: comment.id, item_step_id: comment.itemStepId,
      author: comment.author, role: comment.role,
      text: comment.text, ts: comment.ts
    });
  },

  // ── Purchase lines ──
  async getPurchaseLines(itemStepId) {
    return await sbGet("purchase_lines", `item_step_id=eq.${itemStepId}&order=id.asc`) || [];
  },
  async upsertPurchaseLine(line) {
    return sbUpsert("purchase_lines", {
      id: line.id, item_step_id: line.itemStepId,
      what: line.what || null, order_num: line.orderNum || null,
      provider_id: line.providerId || null,
      delivery_date: line.deliveryDate || null,
      done: !!line.done, files: line.files || []
    });
  },
  async deletePurchaseLine(id) { return sbDelete("purchase_lines", `id=eq.${id}`); },

  // ── Incidents ──
  async getIncidents(itemStepId) {
    return await sbGet("incidents", `item_step_id=eq.${itemStepId}&order=ts.asc`) || [];
  },
  async addIncident(inc) {
    return sbPost("incidents", {
      id: inc.id, item_step_id: inc.itemStepId,
      author: inc.author, role: inc.role,
      type: inc.type || null, note: inc.note || null,
      photos: inc.photos || [], ts: inc.ts
    });
  },

  // ── Incident types (still in fab_storage for simplicity) ──
  async getIncidentTypes() {
    return await legacyDb.get("incidentTypes") || DEFAULT_INCIDENT_TYPES;
  },
  async saveIncidentTypes(types) {
    const r = await fetch(SUPA_URL + "/rest/v1/fab_storage", {
      method: "POST",
      headers: { ...HS },
      body: JSON.stringify({ key: "incidentTypes", value: JSON.stringify(types), updated_at: new Date().toISOString() })
    });
    return r.ok;
  },
};

// ─── DB ↔ App shape converters ─────────────────────────────────────────────────
function dbCatalogToApp(r) {
  return {
    id: r.id, tipo: r.tipo || "", linea: r.linea || "",
    articulo: r.articulo, ref: r.ref || "",
    steps: r.steps || {}, stepSettings: r.step_settings || {},
    files: r.files || []
  };
}
function dbOrderToApp(r) {
  return {
    id: r.id, number: r.number, client: r.client,
    clientId: r.client_id, clientContact: r.client_contact || "",
    clientPublicidad: !!r.client_publicidad, ref: r.ref || "",
    dateStart: r.date_start || "", dateEnd: r.date_end || "",
    released: !!r.released, archived: !!r.archived,
    assignedUsers: r.assigned_users || [],
    files: r.files || [],
    createdAt: r.created_at,
    // These get loaded separately when opening an order
    items: [], comments: []
  };
}
function dbItemStepToApp(r) {
  return {
    id: r.id,
    stepKey: r.step_key,
    enabled: !!r.enabled,
    done: !!r.done,
    dateStart: r.date_start || "",
    date: r.date_end || "",
    doneAt: r.done_at || "",
    totalSeconds: r.total_seconds || 0,
    running: !!r.running,
    startTs: r.start_ts || null,
    what: r.what || "",
    orderNum: r.order_num || "",
    checks: r.checks || {},
    photos: r.photos || [],
    files: r.files || [],
    // Loaded separately
    log: [], comments: [], lines: [], entries: []
  };
}

// ─── Full order loader (loads all related data) ───────────────────────────────
async function loadFullOrder(orderId) {
  const [orderArr, comments, items] = await Promise.all([
    sbGet("orders", `id=eq.${orderId}&select=*`),
    db.getOrderComments(orderId),
    db.getOrderItems(orderId),
  ]);
  if (!orderArr || !orderArr.length) return null;
  const order = dbOrderToApp(orderArr[0]);
  order.comments = comments.map(c => ({
    id: c.id, text: c.text, author: c.author, role: c.role, ts: c.ts
  }));

  order.items = await Promise.all(items.map(async (dbItem) => {
    const item = {
      id: dbItem.id,
      name: dbItem.name || "",
      catalogRef: dbItem.catalog_ref || "",
      catalogId: dbItem.catalog_id || null,
    };

    // Initialize ALL steps with defaults first
    const ALL_STEP_KEYS = ["diseno","compras","soldadura","acabado","cnc","montaje","calidad","embalaje","enviado","incidencias"];
    for (const key of ALL_STEP_KEYS) {
      item[key] = {
        enabled: false, done: false, dateStart: "", date: "", comments: [],
        totalSeconds: 0, running: false, startTs: null, log: [],
        photos: [], files: [], lines: [], entries: [], checks: {}, what: "", orderNum: ""
      };
    }

    const steps = await db.getItemSteps(dbItem.id);

    // If no steps in DB yet, try to reconstruct from catalog
    if (steps.length === 0 && item.catalogId) {
      const catItem = await sbGet("catalog_items", `id=eq.${item.catalogId}&select=*`);
      if (catItem && catItem.length) {
        const cat = catItem[0];
        Object.keys(cat.steps || {}).forEach(k => {
          if (item[k] !== undefined) item[k].enabled = !!cat.steps[k];
        });
        item.incidencias.enabled = true;
      }
    }

    await Promise.all(steps.map(async (dbStep) => {
      const s = dbItemStepToApp(dbStep);
      const key = s.stepKey;
      if (!item[key]) return;

      const [logs, stepComments, purchaseLines, incidents] = await Promise.all([
        STEPS_WITH_TIMER.includes(key) ? db.getTimeLogs(dbStep.id) : Promise.resolve([]),
        db.getStepComments(dbStep.id),
        key === "compras" ? db.getPurchaseLines(dbStep.id) : Promise.resolve([]),
        key === "incidencias" ? db.getIncidents(dbStep.id) : Promise.resolve([]),
      ]);

      s.log = logs.map(l => ({ id: l.id, author: l.author, startTs: l.start_ts, stopTs: l.stop_ts, secs: l.secs }));
      s.comments = stepComments.map(c => ({ id: c.id, text: c.text, author: c.author, role: c.role, ts: c.ts }));
      s.lines = purchaseLines.map(l => ({ id: l.id, what: l.what || "", orderNum: l.order_num || "", providerId: l.provider_id || "", deliveryDate: l.delivery_date || "", done: !!l.done, files: l.files || [] }));
      s.entries = incidents.map(i => ({ id: i.id, author: i.author, role: i.role, type: i.type || "", note: i.note || "", photos: i.photos || [], ts: i.ts }));

      item[key] = s;
    }));

    return item;
  }));

  return order;
}

const STEPS_WITH_TIMER = ["diseno","soldadura","montaje"];

// ─── Save full order to new tables (used for create/edit) ─────────────────────
async function saveFullOrder(order) {
  // 1. Upsert order header
  await db.upsertOrderHeader(order);

  // 2. Get existing items from DB to detect deletions
  const existingItems = await db.getOrderItems(order.id);
  const newItemIds = (order.items || []).map(i => i.id);
  
  // 3. Delete items that are no longer in the order
  for (const existing of existingItems) {
    if (!newItemIds.includes(existing.id)) {
      await sbDelete("item_steps", `item_id=eq.${existing.id}`);
      await db.deleteOrderItem(existing.id);
    }
  }

  // 4. Upsert remaining items and their steps
  const ALL_STEP_KEYS = ["diseno","compras","soldadura","acabado","cnc","montaje","calidad","embalaje","enviado","incidencias"];
  for (let i = 0; i < (order.items || []).length; i++) {
    const item = order.items[i];
    await db.upsertOrderItem(item, order.id, i);

    for (const key of ALL_STEP_KEYS) {
      const stepData = item[key];
      if (!stepData) continue;
      const stepId = item.id + "_" + key;
      await db.upsertItemStep({ ...stepData, id: stepId, itemId: item.id, stepKey: key });
    }
  }
  return true;
}

// ─── Migration from fab_storage ───────────────────────────────────────────────
async function migrateFromLegacy(onProgress) {
  const log = [];
  const progress = (msg) => { log.push(msg); onProgress(msg); };

  try {
    progress("Leyendo datos de fab_storage…");
    const [users, orders, catalog, clients, providers] = await Promise.all([
      legacyDb.get("users"), legacyDb.get("orders"),
      legacyDb.get("catalog"), legacyDb.get("clients"), legacyDb.get("providers")
    ]);

    // Migrate users
    if (users && users.length) {
      progress(`Migrando ${users.length} usuarios…`);
      for (const u of users) {
        const patched = u.token ? u : { ...u, token: "tok-" + Math.random().toString(36).slice(2,10) + "-" + u.id };
        await db.upsertUser(patched);
      }
      progress("✓ Usuarios migrados");
    }

    // Migrate clients
    if (clients && clients.length) {
      progress(`Migrando ${clients.length} clientes…`);
      for (const c of clients) await db.upsertClient(c);
      progress("✓ Clientes migrados");
    }

    // Migrate providers
    if (providers && providers.length) {
      progress(`Migrando ${providers.length} proveedores…`);
      for (const p of providers) await db.upsertProvider({ ...p, leadDays: p.leadDays || 0 });
      progress("✓ Proveedores migrados");
    }

    // Migrate catalog
    if (catalog && catalog.length) {
      progress(`Migrando ${catalog.length} artículos de catálogo…`);
      for (const item of catalog) await db.upsertCatalogItem(item);
      progress("✓ Catálogo migrado");
    }

    // Migrate orders (most complex)
    if (orders && orders.length) {
      progress(`Migrando ${orders.length} pedidos…`);
      for (let oi = 0; oi < orders.length; oi++) {
        const order = orders[oi];
        progress(`  Pedido ${oi + 1}/${orders.length}: #${order.number}`);

        // Order header
        await db.upsertOrderHeader({
          id: order.id || Date.now() + "" + oi,
          number: order.number, client: order.client,
          clientId: order.clientId || null, clientContact: order.clientContact || "",
          clientPublicidad: !!order.clientPublicidad, ref: order.ref || "",
          dateStart: order.dateStart || null, dateEnd: order.dateEnd || null,
          released: !!order.released, archived: !!order.archived,
          assignedUsers: order.assignedUsers || [],
          files: order.files || [],
          createdAt: order.createdAt || new Date().toISOString(),
        });

        // Order comments
        for (const c of (order.comments || [])) {
          await db.addOrderComment({ ...c, orderId: order.id });
        }

        // Order items
        const ALL_STEP_KEYS = ["diseno","compras","soldadura","acabado","cnc","montaje","calidad","embalaje","enviado","incidencias"];
        for (let ii = 0; ii < (order.items || []).length; ii++) {
          const item = order.items[ii];
          const itemId = item.id || order.id + "_item_" + ii;
          await db.upsertOrderItem({ ...item, id: itemId }, order.id, ii);

          // Steps
          for (const key of ALL_STEP_KEYS) {
            const stepData = item[key];
            if (!stepData) continue;
            const stepId = itemId + "_" + key;

            await db.upsertItemStep({
              id: stepId, itemId, stepKey: key,
              enabled: !!stepData.enabled,
              done: !!stepData.done,
              dateStart: stepData.dateStart || null,
              date: stepData.date || null,
              doneAt: stepData.doneAt || null,
              totalSeconds: stepData.totalSeconds || 0,
              running: false, // never migrate a running timer
              startTs: null,
              what: stepData.what || null,
              orderNum: stepData.orderNum || null,
              checks: stepData.checks || {},
              photos: stepData.photos || [],
              files: stepData.files || [],
            });

            // Time logs
            for (const log of (stepData.log || [])) {
              await db.addTimeLog({
                id: log.id || Date.now() + "" + Math.random(),
                itemStepId: stepId,
                author: log.author || "—",
                startTs: log.startTs, stopTs: log.stopTs, secs: log.secs || 0
              });
            }

            // Step comments
            for (const c of (stepData.comments || [])) {
              await db.addStepComment({ ...c, itemStepId: stepId });
            }

            // Purchase lines
            if (key === "compras") {
              for (const line of (stepData.lines || [])) {
                await db.upsertPurchaseLine({ ...line, itemStepId: stepId });
              }
            }

            // Incidents
            if (key === "incidencias") {
              for (const entry of (stepData.entries || [])) {
                await db.addIncident({ ...entry, itemStepId: stepId });
              }
            }
          }
        }
      }
      progress("✓ Pedidos migrados");
    }

    progress("🎉 Migración completada con éxito.");
    return { ok: true, log };
  } catch (e) {
    progress("❌ Error: " + e.message);
    return { ok: false, log };
  }
}

// ─── File Storage (Supabase Storage) ─────────────────────────────────────────
async function uploadFile(dataUrl, fileName) {
  try {
    const [header, b64] = dataUrl.split(",");
    const mime = header.match(/:(.*?);/)[1];
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const ext = fileName.split(".").pop() || "bin";
    const path = Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    const r = await fetch(SUPA_URL + "/storage/v1/object/fab-files/" + path, {
      method: "POST",
      headers: { "apikey": SUPA_SERVICE, "Authorization": "Bearer " + SUPA_SERVICE, "Content-Type": mime, "x-upsert": "true" },
      body: blob
    });
    if (!r.ok) return null;
    return SUPA_URL + "/storage/v1/object/public/fab-files/" + path;
  } catch (e) { return null; }
}
function isStorageUrl(val) { return typeof val === "string" && val.startsWith("http"); }

// ─── ZIP ──────────────────────────────────────────────────────────────────────
function buildZip(files) {
  const enc=new TextEncoder(),parts=[],cd=[];let off=0;
  const crc32=(()=>{const T=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);T[i]=c;}return buf=>{let c=0xFFFFFFFF;for(let i=0;i<buf.length;i++)c=T[(c^buf[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};})();
  const u16=n=>{const b=new Uint8Array(2);new DataView(b.buffer).setUint16(0,n,true);return b;};
  const u32=n=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);return b;};
  const cat=arrs=>{const tot=arrs.reduce((s,a)=>s+a.length,0),out=new Uint8Array(tot);let p=0;for(const a of arrs){out.set(a,p);p+=a.length;}return out;};
  for(const f of files){const nm=enc.encode(f.path);const data=typeof f.data==="string"?enc.encode(f.data):f.data;const crc=crc32(data);const local=cat([new Uint8Array([0x50,0x4B,0x03,0x04]),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(nm.length),u16(0),nm,data]);parts.push(local);cd.push({nm,crc,size:data.length,off});off+=local.length;}
  const cdb=cat(cd.map(e=>cat([new Uint8Array([0x50,0x4B,0x01,0x02]),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(e.crc),u32(e.size),u32(e.size),u16(e.nm.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(e.off),e.nm])));
  const eocd=cat([new Uint8Array([0x50,0x4B,0x05,0x06]),u16(0),u16(0),u16(cd.length),u16(cd.length),u32(cdb.length),u32(off),u16(0)]);
  return cat([...parts,cdb,eocd]);
}
function dlZip(name,u8){const url=URL.createObjectURL(new Blob([u8],{type:"application/zip"}));const a=Object.assign(document.createElement("a"),{href:url,download:name});document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);document.body.removeChild(a);},2000);}

// ─── Constants ────────────────────────────────────────────────────────────────
const INIT_USERS = [
  {id:"u1",username:"admin",    password:"admin123", role:"admin",    name:"Administrador",token:"tok-u1"},
  {id:"u2",username:"disenyo1", password:"dis123",   role:"diseno",   name:"Ana Martínez",token:"tok-u2"},
  {id:"u3",username:"compras1", password:"com123",   role:"compras",  name:"Pedro López",token:"tok-u3"},
  {id:"u4",username:"soldador1",password:"sol123",   role:"soldadura",name:"Carlos Ruiz",token:"tok-u4"},
  {id:"u5",username:"cnc1",     password:"cnc123",   role:"cnc",      name:"Miguel Torres",token:"tok-u5"},
  {id:"u6",username:"montaje1", password:"mon123",   role:"montaje",  name:"Laura García",token:"tok-u6"},
  {id:"u7",username:"calidad1", password:"cal123",   role:"calidad",  name:"Sara Vega",token:"tok-u7"},
  {id:"u8",username:"embalaje1",password:"emb123",   role:"embalaje", name:"José Moreno",token:"tok-u8"},
];

const ROLE_VISIBLE = {
  admin:    ["diseno","compras","soldadura","acabado","cnc","montaje","calidad","embalaje","enviado","incidencias"],
  diseno:   ["diseno","incidencias"],
  compras:  ["diseno","compras","acabado","incidencias"],
  soldadura:["diseno","soldadura","incidencias"],
  cnc:      ["cnc","incidencias"],
  montaje:  ["diseno","montaje","incidencias"],
  calidad:  ["diseno","montaje","calidad","incidencias"],
  embalaje: ["embalaje","incidencias"],
};
const ROLE_OWNS = {
  admin:    ["diseno","compras","soldadura","acabado","cnc","montaje","calidad","embalaje","enviado","incidencias"],
  diseno:   ["diseno","incidencias"],
  compras:  ["compras","incidencias"],
  soldadura:["soldadura","incidencias"],
  cnc:      ["cnc","incidencias"],
  montaje:  ["montaje","incidencias"],
  calidad:  ["calidad","incidencias"],
  embalaje: ["embalaje","incidencias"],
};

const STEPS = [
  {key:"diseno",    label:"Diseño",              color:"pink",   hasTimer:true },
  {key:"compras",   label:"Compras",             color:"amber",  hasTimer:false},
  {key:"soldadura", label:"Soldadura",           color:"orange", hasTimer:true },
  {key:"acabado",   label:"Tratamiento/acabado", color:"violet", hasTimer:false},
  {key:"cnc",       label:"CNC",                 color:"cyan",   hasTimer:true },
  {key:"montaje",   label:"Montaje",             color:"blue",   hasTimer:true },
  {key:"calidad",   label:"Calidad",             color:"green",  hasTimer:false},
  {key:"embalaje",  label:"Embalaje",            color:"indigo", hasTimer:false},
  {key:"enviado",   label:"Enviado",             color:"slate",  hasTimer:false},
];
const INCIDENCIA_STEP = {key:"incidencias",label:"Incidencias",color:"red",hasTimer:false};
const ALL_STEPS = [...STEPS, INCIDENCIA_STEP];

const DEFAULT_INCIDENT_TYPES = [
  "Error de medida","Falta de material","Rotura de herramienta",
  "Defecto de soldadura","Error de diseño","Problema de maquinaria",
  "Pieza defectuosa","Retraso de proveedor","Error de montaje","Otros",
];

const INIT_CLIENTS = [];
const INIT_PROVIDERS = [];

const MTC = ["Tornillería","Matrícula","Edad","Publicidad","Pata columpios 1 punto","Pata columpios 2 puntos"];
const CHK = ["Sí","No","No aplica"];
const SCOL = {diseno:"#ec4899",compras:"#f59e0b",soldadura:"#f97316",cnc:"#06b6d4",acabado:"#8b5cf6",montaje:"#3b82f6",calidad:"#10b981",embalaje:"#6366f1",enviado:"#64748b"};
const MNAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DNAMES = ["L","M","X","J","V","S","D"];

const INIT_CATALOG = [
  {id:"cat1",tipo:"Mobiliario urbano",linea:"Línea Parques",articulo:"Banco modelo estándar",ref:"BAN-001",files:[],steps:{diseno:true,soldadura:true,acabado:true,montaje:true,calidad:true,embalaje:true,enviado:true}},
  {id:"cat2",tipo:"Mobiliario urbano",linea:"Línea Parques",articulo:"Mesa picnic",ref:"MES-001",files:[],steps:{diseno:true,soldadura:true,acabado:true,montaje:true,calidad:true,embalaje:true,enviado:true}},
  {id:"cat3",tipo:"Mobiliario urbano",linea:"Línea Infantil",articulo:"Columpio doble",ref:"COL-001",files:[],steps:{diseno:true,compras:true,soldadura:true,acabado:true,montaje:true,calidad:true,embalaje:true,enviado:true}},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtDT = iso=>{if(!iso)return"";const d=new Date(iso);return d.toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",year:"numeric"})+" "+d.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"});};
const fmtT = s=>`${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
const fmtTShort = s=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h>0?`${h}h ${m}m`:`${m}m`;};
const san = str=>(str||"").replace(/[/\\:*?"<>|]/g,"_").replace(/\s+/g,"_").trim()||"x";
const d2u8 = d=>{try{const b=atob(d.split(",")[1]),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a;}catch{return new Uint8Array(0);}};
const gExt = d=>{const m=d.match(/^data:([^;]+)/);return({"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","application/pdf":"pdf"})[m?.[1]]||"bin";};
const isPDF = f=>f?.type==="application/pdf"||(f?.name||"").toLowerCase().endsWith(".pdf");
const addDays=(iso,days)=>{if(!iso)return"";const d=new Date(iso);if(isNaN(d.getTime()))return iso;d.setDate(d.getDate()+(days||0));return d.toISOString().split("T")[0];};
const openFile = (dataUrl, name) => {
  try {
    const [header, b64] = dataUrl.split(",");
    const mime = header.match(/:(.*?);/)[1];
    const bytes = atob(b64);
    const arr = new Uint8Array(bytes.length);
    for(let i=0;i<bytes.length;i++) arr[i]=bytes.charCodeAt(i);
    const blob = new Blob([arr], {type: mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    if(name) a.download = name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url), 10000);
  } catch(e) { window.open(dataUrl, "_blank"); }
};
const roleColor = r=>({admin:"purple",soldadura:"orange",montaje:"blue",diseno:"pink",compras:"amber",cnc:"cyan",calidad:"green",embalaje:"indigo"}[r]||"gray");
const weekNum = date=>{if(!date||isNaN(date.getTime()))return"";const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));const day=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()+4-day);const y=new Date(Date.UTC(d.getUTCFullYear(),0,1));return Math.ceil((((d-y)/86400000)+1)/7);};
function pickFiles(accept,multi,cb,onUploading){
  const inp=Object.assign(document.createElement("input"),{type:"file",accept,multiple:multi});
  inp.onchange=async e=>{
    const files=Array.from(e.target.files);
    for(const f of files){
      if(onUploading)onUploading(true);
      const r=new FileReader();
      const dataUrl=await new Promise(res=>{r.onload=ev=>res(ev.target.result);r.readAsDataURL(f);});
      const url=await uploadFile(dataUrl,f.name);
      if(onUploading)onUploading(false);
      cb(f, url||dataUrl, url?url:dataUrl);
    }
  };
  inp.click();
}

function itemTotalSecs(item) {
  return STEPS.filter(s=>s.hasTimer).reduce((acc,s)=>{
    if(item[s.key]?.enabled) acc+=item[s.key].totalSeconds||0;
    return acc;
  },0);
}
function orderTotalSecs(order) {
  return (order.items||[]).reduce((acc,item)=>acc+itemTotalSecs(item),0);
}
function isItemDoneForRole(item, role) {
  const owns = (ROLE_OWNS[role]||[]).filter(k=>k!=="incidencias");
  const relevant = owns.filter(k=>item[k]?.enabled);
  if(relevant.length===0) return false;
  return relevant.every(k=>item[k]?.done);
}

function isOrderVisibleForSession(order, session, targetView) {
  const isAdmin = session.role === "admin";
  if (order.archived) return targetView === "archived";
  if (targetView === "archived") return false;
  if (isAdmin) return true;
  const myVisible = ROLE_VISIBLE[session.role] || [];
  if (session.role === "diseno" || session.role === "compras") {
    return (order.items || []).some(item => myVisible.some(sk => item[sk]?.enabled));
  }
  if (!order.released) return false;
  const assignedToMe = (order.assignedUsers || []).includes(session.id);
  if (!assignedToMe) return false;
  return (order.items || []).some(item => myVisible.some(sk => item[sk]?.enabled));
}

function blankItem(catalogEntry) {
  const base = {id:Date.now()+Math.random()+"",name:"",catalogRef:"",catalogId:null,
    diseno:   {enabled:false,done:false,dateStart:"",date:"",totalSeconds:0,running:false,log:[],comments:[],files:[]},
    compras:  {enabled:false,done:false,dateStart:"",date:"",comments:[],lines:[]},
    soldadura:{enabled:false,done:false,dateStart:"",date:"",photos:[],totalSeconds:0,running:false,log:[],comments:[]},
    cnc:      {enabled:false,done:false,dateStart:"",date:"",photos:[],totalSeconds:0,running:false,log:[],comments:[]},
    acabado:  {enabled:false,done:false,dateStart:"",date:"",what:"",orderNum:"",comments:[]},
    montaje:  {enabled:false,done:false,dateStart:"",date:"",photos:[],totalSeconds:0,running:false,log:[],comments:[],checks:{}},
    calidad:  {enabled:false,done:false,dateStart:"",date:"",photos:[],comments:[]},
    embalaje: {enabled:false,done:false,dateStart:"",date:"",photos:[],comments:[]},
    enviado:  {enabled:false,done:false,dateStart:"",date:"",comments:[]},
    incidencias:{enabled:false,done:false,entries:[]},
  };
  if(catalogEntry) {
    base.name = catalogEntry.articulo;
    base.catalogRef = catalogEntry.ref||"";
    base.catalogId = catalogEntry.id||null;
    Object.keys(catalogEntry.steps||{}).forEach(k=>{if(base[k]) base[k].enabled=true;});
    base.incidencias.enabled = true;
    if((catalogEntry.files||[]).length > 0) {
      base.diseno.enabled = true;
      base.diseno.files = (catalogEntry.files||[]).map(f=>({...f, id:Date.now()+Math.random()+""}));
    }
  }
  return base;
}

function autoPlanOrderFromCatalog(order, catalog) {
  if (!order?.dateStart) return order;
  const start = order.dateStart;

  // Track when each role is free (last end date per role)
  const roleNextFree = {};
  STEPS.forEach(s => { roleNextFree[s.key] = start; });

  let globalLastEnd = "";

  const newItems = (order.items || []).map(item => {
    const it = { ...item };
    const tpl = item.catalogId ? catalog.find(c => c.id === item.catalogId) : null;
    const cfgs = tpl?.stepSettings || {};
    const stepEndDate = {}; // tracks when each step of THIS item ends

    STEPS.forEach(step => {
      const k = step.key;
      const d = it[k];
      if (!d?.enabled) return;

      const cfg = cfgs[k] || {};
      const dur = parseInt(cfg.durationDays, 10);
      if (!dur || isNaN(dur) || dur <= 0) return;

      // Earliest start: when this role is free
      let earliest = roleNextFree[k] || start;

      // Also wait for dependency of THIS item to finish
      const dep = cfg.dependsOn;
      if (dep && stepEndDate[dep] && stepEndDate[dep] > earliest) {
        earliest = stepEndDate[dep];
      }

      const sDate = earliest;
      const eDate = addDays(sDate, dur - 1);

      it[k] = { ...d, dateStart: sDate, date: eDate };
      stepEndDate[k] = eDate;

      // This role is now busy until end of this step
      roleNextFree[k] = addDays(eDate, 1);

      if (!globalLastEnd || eDate > globalLastEnd) globalLastEnd = eDate;
    });

    return it;
  });

  const planned = { ...order, items: newItems };
  if (!planned.dateEnd && globalLastEnd) planned.dateEnd = globalLastEnd;
  return planned;
}

// ─── ZIP export ───────────────────────────────────────────────────────────────
async function genZip(order,users) {
  const folder=san(`${order.number}_${order.client}${order.ref?"_"+order.ref:""}`);
  const files=[];
  const txt=(p,c)=>files.push({path:`${folder}/${p}`,data:c||""});
  txt("resumen.txt",[`PEDIDO: #${order.number}`,`CLIENTE: ${order.client}`,`REF: ${order.ref||"—"}`,`INICIO: ${order.dateStart||"—"}`,`ENTREGA: ${order.dateEnd||"—"}`,`TIEMPO TOTAL: ${fmtTShort(orderTotalSecs(order))}`,"","OPERARIOS:",...(order.assignedUsers||[]).map(id=>{const u=users.find(x=>x.id===id);return`  - ${u?.name||"?"} (${u?.role||"—"})`;})].join("\n"));
  txt("observaciones.txt",(order.comments||[]).map(c=>`[${fmtDT(c.ts)}] ${c.author}: ${c.text}`).join("\n")||"—");
  (order.items||[]).forEach((item,idx)=>{
    const lp=`L${idx+1}${item.name?"_"+san(item.name):""}`;
    txt(`${lp}/tiempo_total.txt`,`TIEMPO TOTAL ARTÍCULO: ${fmtTShort(itemTotalSecs(item))}`);
    ALL_STEPS.forEach(step=>{
      const d=item[step.key];if(!d?.enabled)return;
      const sp=`${lp}/${san(step.label)}`;
      txt(`${sp}/obs.txt`,(d.comments||[]).map(c=>`[${fmtDT(c.ts)}] ${c.author}: ${c.text}`).join("\n")||"—");
      if(d.totalSeconds!=null)txt(`${sp}/tiempo.txt`,[`TOTAL: ${fmtT(d.totalSeconds||0)}`,...(d.log||[]).map((e,i)=>`${i+1}. ${e.author} ${fmtDT(e.startTs)}→${fmtDT(e.stopTs)} ${fmtT(e.secs)}`)].join("\n"));
      if(step.key==="compras"){txt(`${sp}/compras.txt`,(d.lines||[]).map((l,i)=>`${i+1}. ${l.what||"—"} | Ped:${l.orderNum||"—"} | Ent:${l.deliveryDate||"—"} | ${l.done?"✓":"⏳"}`).join("\n")||"—");}
      if(step.key==="montaje"&&d.checks)txt(`${sp}/checks.txt`,MTC.map(c=>`${c}: ${d.checks[c]||"—"}`).join("\n"));
      if(step.key==="incidencias"){txt(`${sp}/incidencias.txt`,(d.entries||[]).map((e,i)=>`#${i+1} [${fmtDT(e.ts)}] ${e.author}\nTipo: ${e.type||"—"}\n${e.note||""}`).join("\n\n")||"—");}
    });
  });
  dlZip(`${folder}.zip`,buildZip(files));
}

// ─── UI Primitives ────────────────────────────────────────────────────────────
const BG={pink:"bg-pink-50 border-pink-200",amber:"bg-amber-50 border-amber-200",orange:"bg-orange-50 border-orange-200",cyan:"bg-cyan-50 border-cyan-200",violet:"bg-violet-50 border-violet-200",blue:"bg-blue-50 border-blue-200",green:"bg-emerald-50 border-emerald-200",indigo:"bg-indigo-50 border-indigo-200",slate:"bg-slate-50 border-slate-200",red:"bg-red-50 border-red-200"};
const TXT={pink:"text-pink-700",amber:"text-amber-700",orange:"text-orange-700",cyan:"text-cyan-700",violet:"text-violet-700",blue:"text-blue-700",green:"text-emerald-700",indigo:"text-indigo-700",slate:"text-slate-600",red:"text-red-600"};

function Badge({color,children}){const C={green:"bg-emerald-100 text-emerald-700 border-emerald-200",red:"bg-red-100 text-red-600 border-red-200",blue:"bg-blue-100 text-blue-700 border-blue-200",gray:"bg-slate-100 text-slate-500 border-slate-200",purple:"bg-violet-100 text-violet-700 border-violet-200",orange:"bg-orange-100 text-orange-700 border-orange-200",pink:"bg-pink-100 text-pink-700 border-pink-200",cyan:"bg-cyan-100 text-cyan-700 border-cyan-200",amber:"bg-amber-100 text-amber-700 border-amber-200",indigo:"bg-indigo-100 text-indigo-700 border-indigo-200",slate:"bg-slate-100 text-slate-600 border-slate-200"};return <span className={"inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border "+(C[color]||C.gray)}>{children}</span>;}
function Inp({className="",...p}){return <input {...p} className={"border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent placeholder-slate-300 transition-all "+className}/>;}
function Sel({children,className="",...p}){return <select {...p} className={"border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all "+className}>{children}</select>;}
function Btn({variant="primary",size="md",children,className="",...p}){const V={primary:"bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm",secondary:"bg-slate-100 hover:bg-slate-200 text-slate-700",danger:"bg-red-50 hover:bg-red-100 text-red-600 border border-red-200",ghost:"hover:bg-slate-100 text-slate-600",success:"bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"};const S={sm:"px-3 py-1.5 text-xs",md:"px-4 py-2 text-sm",lg:"px-5 py-2.5 text-base"};return <button {...p} className={"inline-flex items-center gap-2 font-semibold rounded-lg transition-all focus:outline-none disabled:opacity-50 "+(V[variant]||V.primary)+" "+(S[size]||S.md)+" "+className}>{children}</button>;}
function Tog({on,onClick}){return <div className={"w-10 h-6 rounded-full flex items-center px-1 cursor-pointer transition-colors "+(on?"bg-emerald-500":"bg-slate-300")} onClick={onClick}><div className={"w-4 h-4 bg-white rounded-full shadow transition-transform "+(on?"translate-x-4":"translate-x-0")}/></div>;}
function Field({label,children,className=""}){return <div className={"flex flex-col gap-1.5 "+className}><label className="text-sm font-semibold text-slate-600">{label}</label>{children}</div>;}
function Modal({open,onClose,title,size="md",children}){if(!open)return null;const mw={sm:"max-w-md",md:"max-w-lg",lg:"max-w-4xl",xl:"max-w-5xl",full:"max-w-7xl"}[size]||"max-w-lg";return(<div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(15,23,42,0.75)",backdropFilter:"blur(4px)"}}><div className={"bg-white rounded-2xl shadow-2xl w-full "+mw+" flex flex-col"} style={{maxHeight:"92vh"}}><div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 flex-shrink-0"><h2 className="text-lg font-bold text-slate-800">{title}</h2><button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">✕</button></div><div className="p-6 overflow-y-auto flex-1">{children}</div></div></div>);}

// ─── Icons ────────────────────────────────────────────────────────────────────
const ICONS={user:'M12 8a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-5.33 0-8 2.67-8 4v2h16v-2c0-1.33-2.67-4-8-4z',lock:'M19 11H5V21H19V11ZM7 11V7A5 5 0 0 1 17 7V11',logout:'M9 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3H9M16 17L21 12L16 7M21 12H9',plus:'M12 5V19M5 12H19',check:'M20 6 9 17 4 12',x:'M18 6 6 18M6 6 18 18',calendar:'M3 4H21V22H3ZM16 2V6M8 2V6M3 10H21',orders:'M14 2H6A2 2 0 0 0 4 4V20A2 2 0 0 0 6 22H18A2 2 0 0 0 20 20V8ZM14 2V8H20M16 13H8M16 17H8',users:'M17 21V19A4 4 0 0 0 9 19V21M9 7A4 4 0 1 1 9 15 4 4 0 0 1 9 7ZM23 21V19A4 4 0 0 0 17 15.13M16 3.13A4 4 0 0 1 16 11',archive:'M21 8V21H3V8M1 3H23V8H1ZM10 12H14',camera:'M23 19A2 2 0 0 1 21 21H3A2 2 0 0 1 1 19V8A2 2 0 0 1 3 6H7L9 3H15L17 6H21A2 2 0 0 1 23 8ZM12 17A4 4 0 1 0 12 9 4 4 0 0 0 12 17Z',edit:'M11 4H4A2 2 0 0 0 2 6V20A2 2 0 0 0 4 22H18A2 2 0 0 0 20 20V13M18.5 2.5A2.12 2.12 0 0 1 21.5 5.5L12 15 8 16 9 12Z',trash:'M3 6H5H21M19 6V20A2 2 0 0 1 17 22H7A2 2 0 0 1 5 20V6M8 6V4A2 2 0 0 1 10 2H14A2 2 0 0 1 16 4V6',wrench:'M14.7 6.3A1 1 0 0 0 14.7 7.7L16.3 9.3A1 1 0 0 0 17.7 9.3L21.47 5.53A6 6 0 0 1 13.53 13.47L6.62 20.38A2.12 2.12 0 0 1 3.62 17.38L10.53 10.47A6 6 0 0 1 14.7 6.3Z',eye:'M1 12S5 4 12 4 23 12 23 12 19 20 12 20 1 12 1 12ZM12 15A3 3 0 1 0 12 9 3 3 0 0 0 12 15Z',upload:'M16 16 12 12 8 16M12 12V21M20.39 18.39A5 5 0 0 0 18 9H16.74A8 8 0 1 0 3 16.3',file:'M14 2H6A2 2 0 0 0 4 4V20A2 2 0 0 0 6 22H18A2 2 0 0 0 20 20V8ZM14 2V8H20M16 13H8M16 17H8',gantt:'M3 4H11V8H3ZM9 10H19V14H9ZM5 16H17V20H5Z',clock:'M12 22A10 10 0 1 0 12 2 10 10 0 0 0 12 22ZM12 6V12L16 14',msg:'M21 15A2 2 0 0 1 19 17H7L3 21V5A2 2 0 0 1 5 3H19A2 2 0 0 1 21 5Z',send:'M22 2 11 13M22 2 15 22 11 13 2 9 22 2',list:'M8 6H21M8 12H21M8 18H21M3 6H3.01M3 12H3.01M3 18H3.01',shopping:'M9 21A1 1 0 1 0 9 19 1 1 0 0 0 9 21ZM20 21A1 1 0 1 0 20 19 1 1 0 0 0 20 21ZM1 1H5L7.68 14.39A2 2 0 0 0 9.68 16H19.4A2 2 0 0 0 21.4 14.39L23 6H6',cpu:'M4 4H20V20H4ZM9 9H15V15H9ZM9 1V4M15 1V4M9 20V23M15 20V23M20 9H23M20 14H23M1 9H4M1 14H4',paint:'M19 3H5A2 2 0 0 0 3 5V19A2 2 0 0 0 5 21H19A2 2 0 0 0 21 19V5A2 2 0 0 0 19 3ZM9 9H15M9 12H15M9 15H13',box:'M21 16V8A2 2 0 0 0 20 6.27L13 2.27A2 2 0 0 0 11 2.27L4 6.27A2 2 0 0 0 3 8V16A2 2 0 0 0 4 17.73L11 21.73A2 2 0 0 0 13 21.73L20 17.73A2 2 0 0 0 21 16Z',star:'M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2Z',truck:'M1 3H15V16H1ZM16 8H20L23 11V16H16ZM5.5 16A2.5 2.5 0 1 0 5.5 21 2.5 2.5 0 0 0 5.5 16ZM18.5 16A2.5 2.5 0 1 0 18.5 21 2.5 2.5 0 0 0 18.5 16Z',pencil:'M17 3A2.83 2.83 0 0 1 21 7L7.5 20.5 2 22 3.5 16.5Z',qr:'M3 3H9V9H3ZM15 3H21V9H15ZM3 15H9V21H3ZM11 11H13V13H11ZM13 13H15V15H13ZM11 15H13V17H11ZM15 15H17V17H15ZM17 13H19V15H17ZM13 11H21V13H13ZM17 17H21V19H17ZM19 19H21V21H19Z',tool:'M14.7 6.3A1 1 0 0 0 14.7 7.7L16.3 9.3A1 1 0 0 0 17.7 9.3L21.47 5.53A6 6 0 0 1 13.53 13.47L6.62 20.38A2.12 2.12 0 0 1 3.62 17.38L10.53 10.47A6 6 0 0 1 14.7 6.3Z',chevD:'M6 9 12 15 18 9',chevR:'M9 18 15 12 9 6',chevL:'M15 18 9 12 15 6',alert:'M10.29 3.86 1.82 18A2 2 0 0 0 3.53 21H20.47A2 2 0 0 0 22.18 18L13.71 3.86A2 2 0 0 0 10.29 3.86ZM12 9V13M12 17H12.01',book:'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5V19.5Z',layers:'M12 2 2 7 12 12 22 7 12 2ZM2 17 12 22 22 17M2 12 12 17 22 12',filter:'M22 3H2L10 12.46V19L14 21V12.46L22 3Z',time:'M12 22A10 10 0 1 0 12 2 10 10 0 0 0 12 22ZM12 6V12L16 14',migrate:'M4 12V8H8M20 12V16H16M20 8C19 5.5 16.5 4 13.5 4C9.36 4 6 7.36 6 11.5M4 16C5 18.5 7.5 20 10.5 20C14.64 20 18 16.64 18 12.5',};
function Icon({name,size=18}){const d=ICONS[name];if(!d)return null;return(<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{name==="play"?<polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/>:name==="stop"?<rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" stroke="none"/>:<path d={d}/>}</svg>);}

// ─── Migration Panel (admin only) ─────────────────────────────────────────────
function MigrationPanel({ onDone }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [log, setLog] = useState([]);
  const logRef = useRef(null);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  const run = async () => {
    setRunning(true);
    setLog([]);
    const result = await migrateFromLegacy((msg) => {
      setLog(prev => [...prev, msg]);
    });
    setRunning(false);
    setDone(result.ok);
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-black text-slate-800 mb-2">Migración de datos</h1>
      <p className="text-slate-500 text-sm mb-6">
        Mueve todos los datos de <code className="bg-slate-100 px-1 rounded">fab_storage</code> a las nuevas tablas relacionales.
        Esta operación es segura: los datos originales no se borran.
      </p>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-sm text-amber-700 flex items-start gap-2">
        <Icon name="alert" size={16} />
        <div>
          <b>Ejecutar una sola vez.</b> Si ya migraste, volver a ejecutar puede duplicar comentarios y registros de tiempo.
          Asegúrate de que nadie más esté usando la app durante el proceso.
        </div>
      </div>

      {!running && !done && (
        <Btn onClick={run} size="lg">
          <Icon name="migrate" size={18} />
          Iniciar migración
        </Btn>
      )}

      {(running || log.length > 0) && (
        <div className="mt-4">
          <div
            ref={logRef}
            className="bg-slate-900 rounded-xl p-4 h-72 overflow-y-auto font-mono text-xs space-y-1"
          >
            {log.map((line, i) => (
              <div key={i} className={
                line.startsWith("✓") ? "text-emerald-400" :
                line.startsWith("❌") ? "text-red-400" :
                line.startsWith("🎉") ? "text-yellow-400 font-bold" :
                line.startsWith("  ") ? "text-slate-400" :
                "text-slate-200"
              }>{line}</div>
            ))}
            {running && <div className="text-indigo-400 animate-pulse">▋</div>}
          </div>
        </div>
      )}

      {done && (
        <div className="mt-4 flex items-center gap-3">
          <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-emerald-700 text-sm font-semibold flex-1">
            <Icon name="check" size={16} />
            Migración completada. La app ya usa las nuevas tablas.
          </div>
          <Btn onClick={onDone}>Ir a pedidos</Btn>
        </div>
      )}
    </div>
  );
}

// ─── Shared UI components ─────────────────────────────────────────────────────
function CommentBox({comments=[],onAdd,session,label="Observaciones"}){
  const [txt,setTxt]=useState("");const bot=useRef(null);
  useEffect(()=>{bot.current?.scrollIntoView({behavior:"smooth"});},[comments.length]);
  const RC={admin:"bg-violet-100 text-violet-700",soldadura:"bg-orange-100 text-orange-700",montaje:"bg-blue-100 text-blue-700",diseno:"bg-pink-100 text-pink-700",compras:"bg-amber-100 text-amber-700",cnc:"bg-cyan-100 text-cyan-700",calidad:"bg-emerald-100 text-emerald-700",embalaje:"bg-indigo-100 text-indigo-700"};
  const send=()=>{const t=txt.trim();if(!t)return;onAdd({id:Date.now()+"",text:t,author:session.name,role:session.role,ts:new Date().toISOString()});setTxt("");};
  return(<div className="mt-2"><p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">{label}</p>{comments.length>0&&(<div className="space-y-2 mb-3 max-h-40 overflow-y-auto pr-1">{comments.map(c=>(<div key={c.id} className="flex gap-2"><div className={"flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black "+(RC[c.role]||"bg-slate-100 text-slate-600")}>{c.author[0]}</div><div className="flex-1 bg-slate-50 rounded-xl rounded-tl-none px-3 py-2 text-sm"><div className="flex items-baseline gap-2 mb-0.5"><span className="font-bold text-slate-700 text-xs">{c.author}</span><span className="text-slate-400 text-xs">{fmtDT(c.ts)}</span></div><p className="text-slate-700 whitespace-pre-wrap">{c.text}</p></div></div>))}<div ref={bot}/></div>)}<div className="flex gap-2"><textarea value={txt} onChange={e=>setTxt(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Observación… (Enter envía)" rows={2} className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-slate-300 resize-none"/><button onClick={send} disabled={!txt.trim()} className="w-10 flex-shrink-0 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 text-white flex items-center justify-center"><Icon name="send" size={14}/></button></div></div>);
}

function useTickEverySecond(active){const [,setTick]=useState(0);useEffect(()=>{if(!active)return;const iv=setInterval(()=>setTick(t=>t+1),1000);return()=>clearInterval(iv);},[active]);}
function calcLiveSeconds(totalSeconds,running,startTs){if(!running||!startTs)return totalSeconds;return totalSeconds+Math.floor((Date.now()-new Date(startTs).getTime())/1000);}

function Timer({totalSeconds=0,running=false,startTs=null,log=[],onUpdate,disabled,session}){
  useTickEverySecond(running);
  const secs=calcLiveSeconds(totalSeconds,running,startTs);
  const lr=useRef(log);useEffect(()=>{lr.current=log;},[log]);
  const play=()=>{const ts=new Date().toISOString();onUpdate({totalSeconds,running:true,startTs:ts,log:lr.current});};
  const stop=()=>{const ss=Math.max(0,secs-totalSeconds);const entry={id:Date.now()+"",startTs:startTs||new Date().toISOString(),stopTs:new Date().toISOString(),secs:ss,author:session?.name||"—"};onUpdate({totalSeconds:secs,running:false,startTs:null,log:[...(lr.current||[]),entry]});};
  const [showLog,setShowLog]=useState(false);
  return(<div><div className="flex items-center gap-3 bg-slate-900 text-white rounded-xl px-4 py-2.5 w-fit"><Icon name="clock" size={14}/><span className="font-mono font-bold text-base tracking-wider">{fmtT(secs)}</span>{!disabled&&(running?<button onClick={stop} className="w-7 h-7 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center"><Icon name="stop" size={10}/></button>:<button onClick={play} className="w-7 h-7 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center"><Icon name="play" size={10}/></button>)}{(log||[]).length>0&&<button onClick={()=>setShowLog(v=>!v)} className="w-7 h-7 rounded-full bg-slate-700 hover:bg-slate-600 flex items-center justify-center"><Icon name="list" size={11}/></button>}</div>{showLog&&(log||[]).length>0&&(<div className="mt-2 bg-slate-50 rounded-xl border border-slate-200 text-xs">{(log||[]).map((e,i)=><div key={e.id||i} className="px-3 py-2 flex items-center gap-2 border-b border-slate-100 last:border-0"><span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center font-bold flex-shrink-0">{i+1}</span><span className="flex-1 text-slate-600">{e.author} · {fmtDT(e.startTs)} → {fmtDT(e.stopTs)}</span><span className="font-mono font-bold bg-white border border-slate-200 rounded px-1.5 py-0.5">{fmtT(e.secs)}</span></div>)}</div>)}</div>);
}

function InlineTimer({totalSeconds=0,running=false,startTs=null,log=[],onUpdate,session}){
  useTickEverySecond(running);
  const secs=calcLiveSeconds(totalSeconds,running,startTs);
  const lr=useRef(log);useEffect(()=>{lr.current=log;},[log]);
  const play=()=>{const ts=new Date().toISOString();onUpdate({totalSeconds,running:true,startTs:ts,log:lr.current});};
  const stop=()=>{const ss=Math.max(0,secs-totalSeconds);const entry={id:Date.now()+"",startTs:startTs||new Date().toISOString(),stopTs:new Date().toISOString(),secs:ss,author:session?.name||"—"};onUpdate({totalSeconds:secs,running:false,startTs:null,log:[...(lr.current||[]),entry]});};
  return(<div className="flex items-center gap-1.5 bg-slate-900 text-white rounded-lg px-2 py-1" onClick={e=>e.stopPropagation()}><span className="font-mono text-xs font-bold tracking-wide">{fmtT(secs)}</span>{running?<button onClick={stop} className="w-5 h-5 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center flex-shrink-0"><Icon name="stop" size={8}/></button>:<button onClick={play} className="w-5 h-5 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center flex-shrink-0"><Icon name="play" size={8}/></button>}</div>);
}

function Photos({photos=[],onAdd,onRemove,disabled}){
  const [uploading,setUploading]=useState(false);
  return(<div className="flex flex-wrap items-center gap-2">{photos.map((ph,i)=>(<div key={i} className="flex items-center gap-1.5 bg-slate-100 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700"><Icon name="camera" size={12}/><a href={ph} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-600 underline">Foto{photos.length>1?" "+(i+1):""}</a>{!disabled&&<button onClick={()=>onRemove(i)} className="text-slate-400 hover:text-red-500 ml-0.5">✕</button>}</div>))}{!disabled&&<button disabled={uploading} onClick={()=>pickFiles("image/*",true,(f,url)=>onAdd(url),setUploading)} className={"flex items-center gap-1.5 bg-white border border-dashed border-slate-300 hover:border-indigo-400 hover:text-indigo-600 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-all"+(uploading?" opacity-50 cursor-wait":"")}><Icon name="camera" size={12}/>{uploading?"Subiendo...":"Foto"}</button>}</div>);
}

function FileAttachList({files=[],onAdd,onRemove,disabled,accent="indigo"}){
  const [uploading,setUploading]=useState(false);
  const cls={indigo:"border-indigo-300 hover:border-indigo-500 text-indigo-500 hover:text-indigo-600",pink:"border-pink-300 hover:border-pink-500 text-pink-500 hover:text-pink-600"}[accent]||"border-indigo-300 hover:border-indigo-500 text-indigo-500";
  const openAny=(f)=>{if(isStorageUrl(f.url||f.data))window.open(f.url||f.data,"_blank");else openFile(f.data,f.name);};
  return(<div><div className="flex flex-wrap gap-2 mb-2">{files.map((f,i)=>(<div key={f.id||i} className="flex items-center gap-1.5 bg-slate-100 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 max-w-xs"><Icon name={isPDF(f)?"file":"camera"} size={12}/><button onClick={()=>openAny(f)} className="hover:text-indigo-600 underline truncate text-left" title={f.name}>{f.name||"Archivo "+(i+1)}</button>{!disabled&&<button onClick={()=>onRemove(i)} className="text-slate-400 hover:text-red-500 ml-0.5 flex-shrink-0">✕</button>}</div>))}{files.length===0&&disabled&&<p className="text-xs text-slate-400">Sin archivos adjuntos</p>}</div>{!disabled&&<button disabled={uploading} onClick={()=>pickFiles("image/*,.pdf,application/pdf",true,(f,url)=>onAdd({id:Date.now()+"",name:f.name,url,type:f.type}),setUploading)} className={"flex items-center gap-1.5 bg-white border border-dashed rounded-lg px-3 py-2 text-xs font-semibold transition-all "+cls+(uploading?" opacity-50 cursor-wait":"")}><Icon name="upload" size={13}/>{uploading?"Subiendo...":"Adjuntar imagen o PDF"}</button>}</div>);
}

function ComprasLines({lines=[],onUpdate,disabled,providers=[]}){
  const nl=()=>({id:Date.now()+"",what:"",orderNum:"",providerId:"",deliveryDate:"",done:false,files:[]});
  const upd=(id,k,v)=>onUpdate(lines.map(l=>l.id===id?{...l,[k]:v}:l));
  const setProvider=(line,providerId)=>{const prov=providers.find(p=>p.id===providerId);let extra={};const days=parseInt(prov?.leadDays,10);if(!line.deliveryDate&&prov&&days>0){extra.deliveryDate=addDays(new Date().toISOString().split("T")[0],days);}onUpdate(lines.map(l=>l.id===line.id?{...l,providerId,...extra}:l));};
  return(<div className="space-y-3">{lines.map((line,idx)=>(<div key={line.id} className="border border-amber-200 rounded-xl p-3 bg-amber-50/40"><div className="flex items-start gap-2"><span className="text-xs font-bold text-amber-600 mt-2.5 w-5 flex-shrink-0">{idx+1}</span><div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2"><Inp value={line.what} onChange={e=>upd(line.id,"what",e.target.value)} disabled={disabled} placeholder="Qué se compra" className="col-span-1"/><Sel value={line.providerId||""} onChange={e=>setProvider(line,e.target.value)} disabled={disabled} className="col-span-1"><option value="">Proveedor…</option>{providers.map(p=><option key={p.id} value={p.id}>{p.name}{p.leadDays?` · ${p.leadDays}d`:``}</option>)}</Sel><Inp value={line.orderNum} onChange={e=>upd(line.id,"orderNum",e.target.value)} disabled={disabled} placeholder="Nº pedido"/><Inp type="date" value={line.deliveryDate} onChange={e=>upd(line.id,"deliveryDate",e.target.value)} disabled={disabled}/></div><div className="flex items-center gap-2 mt-1.5 flex-shrink-0">{!disabled&&<><Tog on={line.done} onClick={()=>upd(line.id,"done",!line.done)}/><button onClick={()=>onUpdate(lines.filter(l=>l.id!==line.id))} className="text-red-400 hover:text-red-600">✕</button></>}{disabled&&<Badge color={line.done?"green":"amber"}>{line.done?"Recibido":"Pendiente"}</Badge>}</div></div></div>))}{!disabled&&<button onClick={()=>onUpdate([...lines,nl()])} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 mt-1"><Icon name="plus" size={13}/>Añadir línea de compra</button>}{lines.length===0&&disabled&&<p className="text-xs text-slate-400">Sin líneas de compra</p>}</div>);
}

function Checks({checks={},onUpdate,disabled}){return(<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{MTC.map(ch=>(<div key={ch} className="flex items-center gap-3"><span className="text-sm font-semibold text-slate-700 w-24 flex-shrink-0">{ch}</span>{disabled?<Badge color={checks[ch]==="Sí"?"green":checks[ch]==="No"?"red":"gray"}>{checks[ch]||"—"}</Badge>:<div className="flex gap-1">{CHK.map(v=><button key={v} onClick={()=>{const nc={...checks};if(nc[ch]===v)delete nc[ch];else nc[ch]=v;onUpdate(nc);}} className={"px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all "+(checks[ch]===v?(v==="Sí"?"bg-emerald-100 border-emerald-300 text-emerald-700":v==="No"?"bg-red-100 border-red-300 text-red-700":"bg-slate-200 border-slate-300 text-slate-600"):"bg-white border-slate-200 text-slate-400 hover:border-slate-300")}>{v}</button>)}</div>}</div>))}</div>);}

function IncidenciasPanel({entries=[],onAdd,session,incidentTypes=[]}){
  const [type,setType]=useState("");const [note,setNote]=useState("");const [photos,setPhotos]=useState([]);
  const allTypes=[...incidentTypes.filter(t=>t!=="Otros"),"Otros"];
  const send=()=>{if(!type&&!note.trim()&&photos.length===0)return;onAdd({id:Date.now()+"",ts:new Date().toISOString(),author:session.name,role:session.role,type:type||"Otros",note:note.trim(),photos:[...photos]});setType("");setNote("");setPhotos([]);};
  const RC={admin:"bg-violet-100 text-violet-700",soldadura:"bg-orange-100 text-orange-700",montaje:"bg-blue-100 text-blue-700",diseno:"bg-pink-100 text-pink-700",compras:"bg-amber-100 text-amber-700",cnc:"bg-cyan-100 text-cyan-700",calidad:"bg-emerald-100 text-emerald-700",embalaje:"bg-indigo-100 text-indigo-700"};
  return(<div className="space-y-3">{entries.length>0&&(<div className="space-y-2">{entries.map((e,idx)=>(<div key={e.id} className="bg-white border border-red-100 rounded-xl p-3"><div className="flex items-center gap-2 mb-1.5"><div className={"w-7 h-7 rounded-full flex items-center justify-center text-xs font-black "+(RC[e.role]||"bg-slate-100 text-slate-600")}>{e.author[0]}</div><span className="font-bold text-slate-700 text-xs">{e.author}</span><span className="text-slate-400 text-xs">{fmtDT(e.ts)}</span><Badge color="red">#{idx+1}</Badge>{e.type&&<Badge color="orange">{e.type}</Badge>}</div>{e.note&&<p className="text-sm text-slate-700 whitespace-pre-wrap mb-2 pl-9">{e.note}</p>}{(e.photos||[]).length>0&&(<div className="flex flex-wrap gap-2 pl-9">{(e.photos||[]).map((ph,pi)=><a key={pi} href={ph} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 rounded-lg px-2 py-1 text-xs text-slate-600"><Icon name="camera" size={11}/>Foto {pi+1}</a>)}</div>)}</div>))}</div>)}<div className="bg-red-50 border border-red-200 rounded-xl p-3"><p className="text-xs font-bold text-red-400 uppercase tracking-wide mb-2 flex items-center gap-1"><Icon name="alert" size={11}/>Nueva incidencia</p><div className="space-y-2"><Sel value={type} onChange={e=>setType(e.target.value)} className="w-full text-sm"><option value="">— Tipo de incidencia —</option>{allTypes.map(t=><option key={t} value={t}>{t}</option>)}</Sel>{(type==="Otros"||!type)&&<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Describe la incidencia…" rows={2} className="w-full border border-red-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 placeholder-slate-300 resize-none bg-white"/>}{photos.length>0&&(<div className="flex flex-wrap gap-2">{photos.map((ph,i)=><div key={i} className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs"><Icon name="camera" size={10}/>Foto {i+1}<button onClick={()=>setPhotos(pp=>pp.filter((_,j)=>j!==i))} className="text-slate-400 hover:text-red-500 ml-0.5">✕</button></div>)}</div>)}</div><div className="flex gap-2 mt-2"><button onClick={()=>pickFiles("image/*",true,(f,url)=>setPhotos(pp=>[...pp,url]))} className="flex items-center gap-1.5 border border-dashed border-red-300 hover:border-red-500 hover:text-red-600 rounded-lg px-3 py-1.5 text-xs font-medium text-red-400 transition-all"><Icon name="camera" size={11}/>Foto</button><button onClick={send} disabled={!type&&!note.trim()&&photos.length===0} className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-30 text-white rounded-lg px-3 py-1.5 text-xs font-semibold"><Icon name="plus" size={11}/>Registrar</button></div></div></div>);
}

// ─── Gantt ────────────────────────────────────────────────────────────────────
function GanttChart({order}) {
  const bars = [];const allDates = [];
  if (order.dateStart) allDates.push(order.dateStart);
  if (order.dateEnd) allDates.push(order.dateEnd);
  (order.items || []).forEach((item, idx) => {STEPS.forEach(step => {const d = item[step.key];if (!d?.enabled) return;let ds = [];if (step.key === "compras") {ds = (d.lines || []).filter(l => l.deliveryDate).map(l => l.deliveryDate);} else {ds = [d.dateStart, d.date, d.doneAt].filter(Boolean);if (ds.length === 0 && (d.log || []).length > 0) {(d.log || []).forEach(e => {if (e.startTs) ds.push(e.startTs.split("T")[0]);if (e.stopTs) ds.push(e.stopTs.split("T")[0]);});}}if (ds.length > 0) {ds.sort();bars.push({key: step.key,label: step.label,itemLabel: `L${idx + 1}${item.name ? " · " + item.name : ""}`,start: ds[0],end: ds[ds.length - 1],done: d.done,color: SCOL[step.key] || "#64748b",estimated: false,});allDates.push(...ds);}});});
  if (bars.length === 0 && (order.dateStart || order.dateEnd)) {(order.items || []).forEach((item, idx) => {STEPS.forEach(step => {const d = item[step.key];if (!d?.enabled) return;const s = order.dateStart || order.dateEnd;const e = order.dateEnd || order.dateStart;bars.push({key: step.key,label: step.label,itemLabel: `L${idx + 1}${item.name ? " · " + item.name : ""}`,start: s,end: e,done: d.done,color: SCOL[step.key] || "#64748b",estimated: true,});allDates.push(s, e);});})}
  if (bars.length === 0) return (<div className="text-center py-16"><div className="inline-flex flex-col items-center gap-3 text-slate-400"><Icon name="gantt" size={40} /><p className="text-sm font-medium">No hay fechas registradas todavía.</p></div></div>);
  allDates.sort();const minDate = new Date(allDates[0]);const maxDate = new Date(allDates[allDates.length - 1]);minDate.setDate(minDate.getDate() - 2);maxDate.setDate(maxDate.getDate() + 3);
  const totalMs = maxDate - minDate;const pct = dateStr => Math.min(100, Math.max(0, ((new Date(dateStr) - minDate) / totalMs) * 100));const widPct = (s, e) => {const endD = new Date(e);endD.setDate(endD.getDate() + 1);return Math.max(0.5, ((endD - new Date(s)) / totalMs) * 100);};
  const ticks = [];let tc = new Date(minDate);tc.setDate(tc.getDate() - tc.getDay() + 1);while (tc <= maxDate) {if (tc >= minDate) ticks.push({date: new Date(tc),pct: Math.min(100, Math.max(0, ((tc - minDate) / totalMs) * 100)),week: weekNum(tc),});tc.setDate(tc.getDate() + 7);}
  const today = new Date().toISOString().split("T")[0];const todayPct = pct(today);const hasEstimated = bars.some(b => b.estimated);
  const itemGroups = {};bars.forEach(bar => {if (!itemGroups[bar.itemLabel]) itemGroups[bar.itemLabel] = [];itemGroups[bar.itemLabel].push(bar);});
  const ROW_H = 36;const LABEL_W = 180;
  return (<div className="space-y-4">{hasEstimated && (<div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-700 font-medium"><Icon name="alert" size={13} />Estimación basada en fechas del pedido</div>)}<div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500 px-1">{STEPS.filter(s => bars.some(b => b.key === s.key)).map(s => (<div key={s.key} className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: SCOL[s.key] }} />{s.label}</div>))}<div className="flex items-center gap-1.5 ml-2 border-l border-slate-200 pl-3"><div className="w-3 h-3 rounded-sm bg-emerald-500 opacity-60" />Completado</div></div><div style={{ overflowX: "auto" }}><div style={{ minWidth: 640 }}><div className="flex" style={{ marginLeft: LABEL_W, marginBottom: 4 }}><div className="flex-1 relative" style={{ height: 40 }}>{(() => {const months = [];let cur = new Date(minDate);cur.setDate(1);while (cur <= maxDate) {const p = Math.max(0, ((cur - minDate) / totalMs) * 100);months.push({ label: MNAMES[cur.getMonth()].slice(0, 3) + " " + cur.getFullYear(), pct: p });cur.setMonth(cur.getMonth() + 1);}return months.map((m, i) => (<div key={i} className="absolute top-0 text-xs font-bold text-slate-500" style={{ left: m.pct + "%", paddingLeft: 4 }}>{m.label}</div>));})()} {ticks.map((t, i) => (<div key={i} className="absolute flex flex-col items-center" style={{ left: t.pct + "%", top: 16, transform: "translateX(-50%)" }}><div className="text-xs text-slate-400 whitespace-nowrap">S{t.week} · {t.date.getDate()}/{t.date.getMonth() + 1}</div></div>))}</div></div><div className="relative">{Object.entries(itemGroups).map(([itemLabel, itemBars]) => (<div key={itemLabel}><div className="flex items-center" style={{ height: ROW_H }}><div style={{ width: LABEL_W, flexShrink: 0 }} className="pr-3 flex items-center"><span className="text-xs font-bold text-slate-700 truncate bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-0.5 w-full text-center">{itemLabel}</span></div><div className="flex-1 relative h-full flex items-center"><div className="w-full h-px bg-indigo-100" /></div></div>{itemBars.map((bar, bi) => (<div key={bi} className="flex items-center group" style={{ height: ROW_H }}><div style={{ width: LABEL_W, flexShrink: 0 }} className="pr-3 flex items-center justify-end"><div className="flex items-center gap-1.5">{bar.done && <span className="text-emerald-500 text-xs font-black">✓</span>}<span className="text-xs font-semibold truncate" style={{ color: bar.color, maxWidth: 130 }}>{bar.label}</span></div></div><div className="flex-1 relative" style={{ height: ROW_H }}><div className="absolute inset-y-0 flex items-center" style={{ left: 0, right: 0 }}><div className="absolute rounded-lg flex items-center overflow-hidden" style={{ left: pct(bar.start) + "%", width: widPct(bar.start, bar.end) + "%", height: 22, background: bar.done ? bar.color + "55" : bar.estimated ? "repeating-linear-gradient(45deg," + bar.color + "22," + bar.color + "22 4px,transparent 4px,transparent 8px)" : bar.color + "dd", border: "2px " + (bar.estimated ? "dashed" : "solid") + " " + bar.color, minWidth: 4 }}>{widPct(bar.start, bar.end) > 8 && (<span className="px-2 text-xs font-bold whitespace-nowrap overflow-hidden" style={{ color: bar.done || bar.estimated ? bar.color : "#fff", textShadow: bar.done || bar.estimated ? "none" : "0 1px 2px rgba(0,0,0,.3)" }}>{bar.start === bar.end ? bar.start : bar.start + " → " + bar.end}</span>)}</div><div className="absolute z-20 bg-slate-900 text-white text-xs rounded-lg px-3 py-2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity shadow-xl whitespace-nowrap" style={{ left: pct(bar.start) + "%", top: -36, transform: "translateX(-20%)" }}><div className="font-bold mb-0.5">{bar.label} — {bar.itemLabel}</div><div>{bar.start} → {bar.end}</div>{bar.done && <div className="text-emerald-400 mt-0.5">✓ Completado</div>}</div></div></div></div>))}</div>))}{todayPct >= 0 && todayPct <= 100 && (<div className="absolute top-0 bottom-0 z-10 pointer-events-none" style={{ left: LABEL_W + "px" }}><div className="absolute top-0 bottom-0 w-0.5 bg-red-400 opacity-80" style={{ left: todayPct + "%" }} /></div>)}</div><div className="flex items-center gap-6 mt-3 pt-3 border-t border-slate-100" style={{ marginLeft: LABEL_W }}><div className="flex items-center gap-2 text-xs text-slate-500"><div className="w-0.5 h-4 bg-red-400" /><span>Hoy: <b className="text-slate-700">{today}</b></span></div>{order.dateEnd && (<div className="flex items-center gap-2 text-xs text-slate-500"><div className="w-3 h-0.5 border-t-2 border-dashed border-slate-400" /><span>Entrega: <b className="text-slate-700">{order.dateEnd}</b></span></div>)}</div></div></div></div>);
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
function CalendarView({orders, users, session, isAdmin, onOrderClick}) {
  const today = new Date();const [month, setMonth] = useState(today.getMonth());const [year, setYear] = useState(today.getFullYear());const [filterUser, setFilterUser] = useState("");const [filterClient, setFilterClient] = useState("");const [filterStep, setFilterStep] = useState("");const [popover, setPopover] = useState(null);
  const firstDay = new Date(year, month, 1).getDay();const offset = firstDay === 0 ? 6 : firstDay - 1;const dim = new Date(year, month + 1, 0).getDate();
  const allClients = [...new Set(orders.map(o => o.client).filter(Boolean))].sort();const ops = users.filter(u => u.role !== "admin");
  const DOT = {diseno:"#ec4899",compras:"#f59e0b",soldadura:"#f97316",cnc:"#06b6d4",acabado:"#8b5cf6",montaje:"#3b82f6",calidad:"#10b981",embalaje:"#6366f1",enviado:"#64748b",inicio:"#6366f1",entrega:"#ef4444"};
  const myVisible = ROLE_VISIBLE[session.role] || [];
  const events = {};
  const addEv = (ds, ev) => {if (!ds) return;const pts = ds.split("-");if (pts.length < 3) return;const m2 = parseInt(pts[1]) - 1, y2 = parseInt(pts[0]), d2 = parseInt(pts[2]);if (m2 === month && y2 === year) {if (!events[d2]) events[d2] = [];events[d2].push(ev);}};
  orders.forEach(order => {
    if (!isAdmin) {const isMyOrder = (order.assignedUsers || []).includes(session.id) || ((session.role === "diseno" || session.role === "compras") && (order.items || []).some(item => myVisible.some(sk => item[sk]?.enabled)));if (!isMyOrder) return;}
    if (filterUser && !(order.assignedUsers || []).includes(filterUser)) return;if (filterClient && order.client !== filterClient) return;
    if (!isAdmin) {(order.items || []).forEach((item, idx) => {const sub = `${order.number}-${idx + 1}${item.name ? " · " + item.name : ""}`;myVisible.filter(sk => sk !== "incidencias").forEach(sk => {const step = STEPS.find(s => s.key === sk);if (!step) return;const d = item[sk];if (!d?.enabled || d?.done) return;if (filterStep && filterStep !== sk) return;const ds2 = sk === "compras" ? (d.lines || []).filter(l => l.deliveryDate && !l.done).map(l => l.deliveryDate) : [d.dateStart, d.date, d.doneAt].filter(Boolean);ds2.forEach(date => addEv(date, { label: step.label, subLabel: sub, color: sk, orderId: order.id }));});});return;}
    if (!filterStep) {addEv(order.dateStart, { label: "Inicio", subLabel: `#${order.number} · ${order.client}`, color: "inicio", orderId: order.id });addEv(order.dateEnd, { label: "Entrega", subLabel: `#${order.number} · ${order.client}`, color: "entrega", orderId: order.id });}
    (order.items || []).forEach((item, idx) => {const sub = `${order.number}-${idx + 1}${item.name ? " · " + item.name : ""}`;STEPS.forEach(step => {const d = item[step.key];if (!d?.enabled || d?.done) return;if (filterStep && filterStep !== step.key) return;const ds2 = step.key === "compras" ? (d.lines || []).filter(l => l.deliveryDate && !l.done).map(l => l.deliveryDate) : [d.dateStart, d.date, d.doneAt].filter(Boolean);ds2.forEach(date => addEv(date, { label: step.label, subLabel: sub, color: step.key, orderId: order.id }));});});
  });
  const numRows = Math.ceil((offset + dim) / 7);const rows = [];for (let row = 0; row < numRows; row++) {const days = [];for (let col = 0; col < 7; col++) {const d = row * 7 + col - offset + 1;days.push(d >= 1 && d <= dim ? d : null);}const fd = row * 7 - offset + 1;const cd = Math.max(1, Math.min(dim, fd));rows.push({ row, days, wk: weekNum(new Date(year, month, cd)) });}
  const prevM = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };const nextM = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const clickDay = (day, e) => {const evs = events[day];if (!evs?.length) { setPopover(null); return; }if (evs.length === 1) { onOrderClick(evs[0].orderId); return; }e.stopPropagation();const r = e.currentTarget.getBoundingClientRect();setPopover({ day, events: evs, x: r.left, y: r.bottom + 4 });};
  const legendSteps = isAdmin ? [["inicio", "Inicio"], ["entrega", "Entrega"], ...STEPS.map(s => [s.key, s.label])] : myVisible.filter(sk => sk !== "incidencias").map(sk => {const s = STEPS.find(st => st.key === sk);return s ? [s.key, s.label] : null;}).filter(Boolean);
  return (<div onClick={() => setPopover(null)}><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6"><div><h1 className="text-2xl font-black text-slate-800">Calendario</h1>{!isAdmin && <p className="text-slate-500 text-sm">Mostrando tus pendientes — {session.name}</p>}</div><div className="flex flex-wrap gap-2">{isAdmin && <><Sel value={filterClient} onChange={e => setFilterClient(e.target.value)} className="text-xs"><option value="">Todos los clientes</option>{allClients.map(c => <option key={c} value={c}>{c}</option>)}</Sel><Sel value={filterUser} onChange={e => setFilterUser(e.target.value)} className="text-xs"><option value="">Todos los operarios</option>{ops.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</Sel></>}<Sel value={filterStep} onChange={e => setFilterStep(e.target.value)} className="text-xs"><option value="">Todas las fases</option>{(isAdmin ? STEPS : STEPS.filter(s => myVisible.includes(s.key))).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</Sel></div></div><div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div className="flex items-center justify-between px-6 py-4 border-b border-slate-100"><button onClick={prevM} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"><Icon name="chevL" size={14} /></button><h2 className="font-black text-slate-800 text-lg">{MNAMES[month]} {year}</h2><button onClick={nextM} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"><Icon name="chevR" size={14} /></button></div><div className="grid border-b border-slate-100" style={{ gridTemplateColumns: "36px repeat(7,1fr)" }}><div className="text-center text-xs font-bold text-slate-300 py-2 border-r border-slate-100">S</div>{DNAMES.map(d => <div key={d} className="text-center text-xs font-bold text-slate-400 py-2">{d}</div>)}</div>{rows.map(({ row, days, wk }) => (<div key={row} className="grid border-b border-slate-100 last:border-0" style={{ gridTemplateColumns: "36px repeat(7,1fr)" }}><div className="flex items-start justify-center pt-2 border-r border-slate-100"><span className="text-xs font-bold text-slate-300">{wk}</span></div>{days.map((day, col) => {if (!day) return <div key={col} className="border-r border-slate-50 last:border-r-0 min-h-[90px] bg-slate-50/40" />;const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();const dayEvs = events[day] || [];return (<div key={col} onClick={e => clickDay(day, e)} className={"border-r border-slate-100 last:border-r-0 min-h-[90px] p-1.5 " + (dayEvs.length ? "cursor-pointer" : "") + " " + (isToday ? "bg-indigo-50" : "hover:bg-slate-50")}><span className={"inline-flex w-6 h-6 items-center justify-center text-xs font-bold rounded-full mb-1 " + (isToday ? "bg-indigo-600 text-white" : "text-slate-600")}>{day}</span><div className="space-y-0.5">{dayEvs.slice(0, 4).map((ev, j) => (<div key={j} className="rounded px-1.5 py-0.5" style={{ background: (DOT[ev.color] || "#94a3b8") + "18" }}><div className="text-xs font-bold truncate" style={{ color: DOT[ev.color] || "#94a3b8" }}>{ev.label}</div>{ev.subLabel && <div className="text-xs truncate" style={{ color: DOT[ev.color] || "#94a3b8", opacity: .7 }}>{ev.subLabel}</div>}</div>))}{dayEvs.length > 4 && <div className="text-xs text-slate-400 px-1 font-semibold">+{dayEvs.length - 4} más</div>}</div></div>);})}</div>))}</div><div className="flex flex-wrap gap-3 mt-4 items-center text-xs text-slate-500">{legendSteps.map(([k, l]) => (<div key={k + l} className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full" style={{ background: DOT[k] || "#94a3b8" }} />{l}</div>))}</div>{popover && (<div className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 p-3 w-72" style={{ top: Math.min(popover.y, window.innerHeight - 240), left: Math.min(popover.x, window.innerWidth - 300) }} onClick={e => e.stopPropagation()}><p className="text-xs font-bold text-slate-500 mb-2 pb-2 border-b border-slate-100">Día {popover.day}</p><div className="space-y-1 max-h-52 overflow-y-auto">{popover.events.map((ev, i) => (<button key={i} onClick={() => { setPopover(null); onOrderClick(ev.orderId); }} className="w-full text-left flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50"><div className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ background: DOT[ev.color] || "#94a3b8" }} /><div><div className="text-xs font-bold" style={{ color: DOT[ev.color] || "#94a3b8" }}>{ev.label}</div>{ev.subLabel && <div className="text-xs text-slate-500">{ev.subLabel}</div>}</div></button>))}</div></div>)}</div>);
}

// ─── Catalog view ─────────────────────────────────────────────────────────────
function CatalogView({catalog,onSave,users}){
  const [items,setItems]=useState(catalog);const [form,setForm]=useState(null);const [search,setSearch]=useState("");
  useEffect(()=>{setItems(catalog);},[catalog]);
  const tipos=[...new Set(items.map(i=>i.tipo).filter(Boolean))].sort();const lineas=[...new Set(items.map(i=>i.linea).filter(Boolean))].sort();
  const filtered=items.filter(i=>{const q=search.toLowerCase();return !q||(i.tipo||"").toLowerCase().includes(q)||(i.linea||"").toLowerCase().includes(q)||(i.articulo||"").toLowerCase().includes(q)||(i.ref||"").toLowerCase().includes(q);});
  const grouped={};filtered.forEach(item=>{const t=item.tipo||"Sin tipo";const l=item.linea||"Sin línea";if(!grouped[t])grouped[t]={};if(!grouped[t][l])grouped[t][l]=[];grouped[t][l].push(item);});
  const save=async()=>{const updated=form.id?items.map(i=>i.id===form.id?form:i):[...items,{...form,id:Date.now()+""}];await onSave(updated);setForm(null);};
  const del=async id=>{if(!confirm("¿Eliminar artículo?"))return;await db.deleteCatalogItem(id);const updated=items.filter(i=>i.id!==id);setItems(updated);};
  const blankForm=()=>({id:null,tipo:"",linea:"",articulo:"",ref:"",files:[],steps:{},stepSettings:{}});
  const operarios=(users||[]).filter(u=>u.role!=="admin");
  return(<div><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6"><div><h1 className="text-2xl font-black text-slate-800">Catálogo de artículos</h1><p className="text-slate-500 text-sm">{items.length} artículo{items.length!==1?"s":""}</p></div><div className="flex gap-3"><Inp placeholder="Buscar…" value={search} onChange={e=>setSearch(e.target.value)} className="w-44"/><Btn onClick={()=>setForm(blankForm())}><Icon name="plus" size={16}/>Nuevo artículo</Btn></div></div>
  {Object.keys(grouped).sort().map(tipo=>(<div key={tipo} className="mb-6"><h2 className="text-base font-black text-slate-700 mb-3 flex items-center gap-2"><Icon name="layers" size={16}/>{tipo}</h2>{Object.keys(grouped[tipo]).sort().map(linea=>(<div key={linea} className="mb-4 ml-4"><h3 className="text-sm font-bold text-slate-500 mb-2 flex items-center gap-1.5"><Icon name="chevR" size={13}/>{linea}</h3><div className="space-y-2 ml-4">{grouped[tipo][linea].map(item=>(<div key={item.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3"><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-slate-800">{item.articulo}</span>{item.ref&&<Badge color="gray">{item.ref}</Badge>}</div><div className="flex flex-wrap gap-1 mt-1">{STEPS.filter(s=>item.steps?.[s.key]).map(s=><span key={s.key} className={"inline-flex px-1.5 py-0.5 rounded text-xs font-semibold "+(BG[s.color]||"")+" "+(TXT[s.color]||"")}>{s.label}</span>)}</div></div><div className="flex gap-1 flex-shrink-0"><Btn variant="ghost" size="sm" onClick={()=>setForm({...item,steps:{...item.steps},stepSettings:item.stepSettings||{},files:[...(item.files||[])]})}><Icon name="edit" size={13}/></Btn><Btn variant="danger" size="sm" onClick={()=>del(item.id)}><Icon name="trash" size={13}/></Btn></div></div>))}</div></div>))}</div>))}
  {filtered.length===0&&<div className="text-center py-16 text-slate-400"><Icon name="book" size={36}/><p className="mt-3 text-sm font-medium">No hay artículos{search?" que coincidan":""}</p></div>}
  <Modal open={!!form} onClose={()=>setForm(null)} title={form?.id?"Editar artículo":"Nuevo artículo"} size="lg">{form&&(<div className="space-y-4">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Tipo de producto"><Inp value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value}))} placeholder="ej. Mobiliario urbano" list="tipos-list"/><datalist id="tipos-list">{tipos.map(t=><option key={t} value={t}/>)}</datalist></Field>
      <Field label="Línea"><Inp value={form.linea} onChange={e=>setForm(f=>({...f,linea:e.target.value}))} placeholder="ej. Línea Parques" list="lineas-list"/><datalist id="lineas-list">{lineas.map(l=><option key={l} value={l}/>)}</datalist></Field>
      <Field label="Nombre del artículo *"><Inp value={form.articulo} onChange={e=>setForm(f=>({...f,articulo:e.target.value}))} placeholder="ej. Banco modelo estándar"/></Field>
      <Field label="Referencia"><Inp value={form.ref||""} onChange={e=>setForm(f=>({...f,ref:e.target.value}))} placeholder="ej. BAN-001"/></Field>
    </div>
    <Field label="Fases que incluye">
  <div className="space-y-2">
    {STEPS.map(s=>{
      const enabled=!!form.steps?.[s.key];
      const cfg=form.stepSettings?.[s.key]||{};
      const ROLE_FOR_STEP={diseno:"diseno",compras:"compras",soldadura:"soldadura",cnc:"cnc",montaje:"montaje",calidad:"calidad",embalaje:"embalaje"};
      return(
        <div key={s.key} className={"rounded-xl border transition-all "+(enabled?"border-indigo-200 bg-indigo-50":"border-slate-100 bg-white")}>
          <div className="flex items-center gap-3 px-3 py-2.5">
            <button type="button" onClick={()=>setForm(f=>({...f,steps:{...f.steps,[s.key]:!enabled},stepSettings:{...f.stepSettings,[s.key]:{...(f.stepSettings?.[s.key]||{})}}}))} className={"w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all "+(enabled?"bg-indigo-600 border-indigo-600 text-white":"border-slate-300 hover:border-indigo-400")}>
              {enabled&&<Icon name="check" size={10}/>}
            </button>
            <span className={"text-sm font-semibold "+(enabled?"text-indigo-700":"text-slate-400")}>{s.label}</span>
            {enabled&&ROLE_FOR_STEP[s.key]&&<span className="text-xs text-slate-400">→ auto: <b>{ROLE_FOR_STEP[s.key]}</b>{s.key==="montaje"&&" (manual)"}</span>}
          </div>
          {enabled&&(
            <div className="grid grid-cols-2 gap-3 px-3 pb-3">
              <Field label="Duración (días)">
                <Inp type="number" min="1" value={cfg.durationDays||""} onChange={e=>setForm(f=>({...f,stepSettings:{...f.stepSettings,[s.key]:{...(f.stepSettings?.[s.key]||{}),durationDays:e.target.value}}}))} placeholder="ej. 2"/>
              </Field>
              <Field label="Depende de">
                <Sel value={cfg.dependsOn||""} onChange={e=>setForm(f=>({...f,stepSettings:{...f.stepSettings,[s.key]:{...(f.stepSettings?.[s.key]||{}),dependsOn:e.target.value||null}}}))}>
                  <option value="">— Sin dependencia —</option>
                  {STEPS.filter(x=>x.key!==s.key&&form.steps?.[x.key]).map(x=><option key={x.key} value={x.key}>{x.label}</option>)}
                </Sel>
              </Field>
            </div>
          )}
        </div>
      );
    })}
  </div>
</Field>
    <div className="flex justify-end gap-3 pt-2 border-t border-slate-100"><Btn variant="secondary" onClick={()=>setForm(null)}>Cancelar</Btn><Btn onClick={()=>{if(!form.articulo){alert("El nombre es obligatorio");return;}save();}}><Icon name="check" size={15}/>Guardar</Btn></div>
  </div>)}</Modal></div>);
}

// ─── AdminSettings ────────────────────────────────────────────────────────────
function AdminSettings({incidentTypes,onSaveTypes}){
  const [list,setList]=useState(incidentTypes);const [newT,setNewT]=useState("");
  const add=()=>{const t=newT.trim();if(!t||list.includes(t))return;const updated=[...list.filter(x=>x!=="Otros"),t,"Otros"];setList(updated);onSaveTypes(updated);setNewT("");};
  const del=t=>{if(t==="Otros")return;const updated=list.filter(x=>x!==t);setList(updated);onSaveTypes(updated);};
  return(<div className="max-w-lg"><h1 className="text-2xl font-black text-slate-800 mb-6">Configuración</h1><div className="bg-white rounded-2xl border border-slate-200 p-6"><h3 className="font-bold text-slate-700 mb-4">Tipos de incidencia</h3><div className="space-y-2 mb-4">{list.map(t=><div key={t} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2"><span className="text-sm text-slate-700">{t}</span>{t!=="Otros"&&<button onClick={()=>del(t)} className="text-red-400 hover:text-red-600 text-xs">✕</button>}</div>)}</div><div className="flex gap-2"><Inp value={newT} onChange={e=>setNewT(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")add();}} placeholder="Nuevo tipo…" className="flex-1"/><Btn onClick={add} size="sm"><Icon name="plus" size={13}/>Añadir</Btn></div></div></div>);
}

// ─── OrderDetail ──────────────────────────────────────────────────────────────
function OrderDetail({order, users, session, isAdmin, onUpdate, onStepUpdate, incidentTypes, showDone=true, providers=[], clients=[]}) {
  const [exp, setExp] = useState({});
  const [expStep, setExpStep] = useState({});
  const [local, setLocal] = useState(order);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setLocal(order); setDirty(false); }, [order.id]);

  // Granular update — for timer and done actions, write directly to DB
  const upd = async (itemId, stepKey, data) => {
    const isTimer = data.hasOwnProperty("running") || data.hasOwnProperty("totalSeconds") || data.hasOwnProperty("startTs");
    const isDone = data.hasOwnProperty("done") && !data.hasOwnProperty("running");

    // Update local state immediately for responsiveness
    const updated = {
      ...local,
      items: local.items.map(it => it.id === itemId
        ? { ...it, [stepKey]: { ...it[stepKey], ...data } }
        : it
      )
    };
    setLocal(updated);

    const stepId = itemId + "_" + stepKey;

    if (isTimer) {
      // Granular: only update timer fields
      await db.patchStepTimer(stepId, {
        totalSeconds: data.totalSeconds ?? local.items.find(i=>i.id===itemId)?.[stepKey]?.totalSeconds ?? 0,
        running: !!data.running,
        startTs: data.startTs || null,
      });
      // If stopping, also save the log entry
      if (data.running === false && data.log && data.log.length > 0) {
        const lastEntry = data.log[data.log.length - 1];
        if (lastEntry && !lastEntry._saved) {
          await db.addTimeLog({ ...lastEntry, itemStepId: stepId });
          lastEntry._saved = true;
        }
      }
      onUpdate(updated);
    } else if (isDone) {
      // Granular: only update done flag
      await db.patchStepDone(stepId, !!data.done, data.doneAt || null);
      onUpdate(updated);
    } else {
      // Non-critical change: mark dirty, save on button click
      setDirty(true);
    }
  };

  const addCmt = async (c) => {
    const updated = { ...local, comments: [...(local.comments || []), c] };
    setLocal(updated);
    await db.addOrderComment({ ...c, orderId: order.id });
    onUpdate(updated);
  };

  const addStepCmt = async (itemId, stepKey, c) => {
    const stepId = itemId + "_" + stepKey;
    const updated = {
      ...local,
      items: local.items.map(it => it.id === itemId
        ? { ...it, [stepKey]: { ...it[stepKey], comments: [...(it[stepKey]?.comments || []), c] } }
        : it
      )
    };
    setLocal(updated);
    await db.addStepComment({ ...c, itemStepId: stepId });
    onUpdate(updated);
  };

  const saveNow = async () => {
    setSaving(true);
    await saveFullOrder(local);
    setDirty(false);
    setSaving(false);
  };

  const myVisible = ROLE_VISIBLE[session.role] || [];
  const myOwns = ROLE_OWNS[session.role] || [];
  const canSeeStep = k => isAdmin || myVisible.includes(k);
  const canEditStep = k => isAdmin || myOwns.includes(k);
  const orderSecs = orderTotalSecs(local);
  const visibleItems = (local.items || []).filter(item => {
    if (isAdmin || showDone) return true;
    return !isItemDoneForRole(item, session.role);
  });
  const hiddenCount = (local.items || []).length - visibleItems.length;
  const clientInfo = (clients || []).find(c => c.id === local.clientId) || (clients || []).find(c => c.name === local.client);
  const clientContact = local.clientContact || clientInfo?.contact || "";
  const clientPub = local.clientPublicidad != null ? local.clientPublicidad : !!clientInfo?.publicidad;
  const ICO = {diseno:"pencil",compras:"shopping",soldadura:"wrench",cnc:"cpu",acabado:"paint",montaje:"tool",calidad:"star",embalaje:"box",enviado:"truck",incidencias:"alert"};

  return (
    <div className="space-y-5">
      {dirty && (
        <div className="sticky top-0 z-20 flex items-center justify-between bg-amber-50 border border-amber-300 rounded-xl px-4 py-2.5 shadow-md">
          <div className="flex items-center gap-2 text-amber-700 text-sm font-semibold"><Icon name="alert" size={15}/>Hay cambios sin guardar</div>
          <button onClick={saveNow} disabled={saving} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white font-bold px-4 py-1.5 rounded-lg text-sm transition-all">{saving?"Guardando…":"💾 Guardar"}</button>
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[["Cliente",local.client||"—"],["Contacto",clientContact||"—"],["Publicidad",clientPub?"Sí":"No"],["Referencia",local.ref||"—"],["Inicio",local.dateStart||"—"],["Entrega",local.dateEnd||"—"]].map(([l,v])=>(
          <div key={l} className="bg-slate-50 rounded-xl p-3"><p className="text-slate-400 text-xs mb-0.5">{l}</p><p className="font-bold text-slate-800 text-sm truncate" title={v}>{v}</p></div>
        ))}
      </div>
      {orderSecs > 0 && <div className="bg-slate-900 text-white rounded-xl px-4 py-3 flex items-center gap-3"><Icon name="time" size={16}/><span className="text-sm font-semibold">Tiempo total:</span><span className="font-mono font-black text-lg">{fmtTShort(orderSecs)}</span><span className="text-slate-400 text-xs">({fmtT(orderSecs)})</span></div>}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Documentos del pedido</p>
        <FileAttachList files={local.files||[]} onAdd={f=>{const nf=[...(local.files||[]),f];setLocal(l=>({...l,files:nf}));setDirty(true);}} onRemove={i=>{const nf=(local.files||[]).filter((_,j)=>j!==i);setLocal(l=>({...l,files:nf}));setDirty(true);}} disabled={!isAdmin} accent="indigo"/>
        <div className="mt-3 border-t border-slate-100 pt-3"><CommentBox comments={local.comments||[]} onAdd={addCmt} session={session} label="Observaciones del pedido"/></div>
      </div>
      <h3 className="font-bold text-slate-800">Artículos</h3>
      {hiddenCount > 0 && <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-sm text-emerald-700"><Icon name="check" size={15}/><span>{hiddenCount} artículo{hiddenCount!==1?"s":""} completado{hiddenCount!==1?"s":""} oculto{hiddenCount!==1?"s":""}.</span></div>}
      <div className="space-y-3">
        {visibleItems.map((item, idx) => {
          const incN = (item.incidencias?.enabled && item.incidencias?.entries?.length) || 0;
          const visibleSteps = ALL_STEPS.filter(s => item[s.key]?.enabled && canSeeStep(s.key));
          const itemSecs = itemTotalSecs(item);
          return (
            <div key={item.id} className="border border-slate-200 rounded-xl overflow-hidden">
              <button className="w-full flex items-center justify-between p-4 bg-white hover:bg-slate-50 text-left" onClick={() => setExp(e => ({ ...e, [item.id]: !e[item.id] }))}>
                <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
                  <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-black flex items-center justify-center flex-shrink-0">{idx + 1}</span>
                  <div className="min-w-0"><span className="font-bold text-slate-800">{item.name || "(sin nombre)"}</span>{item.catalogRef && <span className="text-xs text-slate-400 ml-2">{item.catalogRef}</span>}</div>
                  {itemSecs > 0 && <span className="flex items-center gap-1 text-xs font-mono font-bold text-slate-500 bg-slate-100 rounded-lg px-2 py-0.5"><Icon name="clock" size={11}/>{fmtTShort(itemSecs)}</span>}
                  <div className="flex flex-wrap gap-1">{visibleSteps.map(s => { const done = item[s.key]?.done; return <span key={s.key} className={"inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold border " + (done ? "bg-emerald-100 border-emerald-200 text-emerald-700" : (BG[s.color] || "") + " " + (TXT[s.color] || ""))}>{done && "✓ "}{s.label}</span>; })}</div>
                  {incN > 0 && <Badge color="red">{incN} incid.</Badge>}
                </div>
                <Icon name={exp[item.id] ? "chevD" : "chevR"} size={16}/>
              </button>
              {exp[item.id] && (
                <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-2">
                  {visibleSteps.map(step => {
                    const d = item[step.key];
                    const editable = canEditStep(step.key);
                    const sk = item.id + "_" + step.key;
                    const open = expStep[sk] === true;
                    const summaryParts = [];
                    if (d.dateStart) summaryParts.push("Inicio: " + d.dateStart);
                    if (d.date || d.doneAt) summaryParts.push("Fin: " + (d.date || d.doneAt));
                    return (
                      <div key={step.key} className={"rounded-xl border overflow-hidden " + (BG[step.color] || "bg-slate-50 border-slate-200")}>
                        <div className="flex items-center gap-2 px-3 py-2.5 bg-white/70">
                          <button className="flex items-center gap-2 flex-1 min-w-0 text-left" onClick={() => setExpStep(prev => ({ ...prev, [sk]: !prev[sk] }))}>
                            <div className={"flex items-center gap-1.5 font-bold text-sm " + (TXT[step.color] || "text-slate-700")}><Icon name={ICO[step.key] || "check"} size={13}/>{step.label}</div>
                            {!open && (<div className="flex items-center gap-2 min-w-0">{step.key !== "incidencias" && <Badge color={d.done ? "green" : "gray"}>{d.done ? "✓ Hecho" : "Pendiente"}</Badge>}{step.key === "incidencias" && (d.entries || []).length > 0 && <Badge color="red">{(d.entries || []).length}</Badge>}{summaryParts.length > 0 && <span className="text-xs text-slate-400 hidden sm:inline truncate">{summaryParts.join(" · ")}</span>}</div>)}
                          </button>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {step.hasTimer && editable && <InlineTimer totalSeconds={d.totalSeconds||0} running={d.running||false} startTs={d.startTs||null} log={d.log||[]} session={session} onUpdate={v => upd(item.id, step.key, v)}/>}
                            {step.key !== "incidencias" && editable && <Tog on={d.done} onClick={() => upd(item.id, step.key, { done: !d.done, doneAt: !d.done ? new Date().toISOString().split("T")[0] : null })}/>}
                            <button onClick={() => setExpStep(prev => ({ ...prev, [sk]: !prev[sk] }))} className="text-slate-400 hover:text-slate-600 p-0.5"><Icon name={open ? "chevD" : "chevR"} size={14}/></button>
                          </div>
                        </div>
                        {open && (
                          <div className="px-4 pb-4 pt-3 space-y-3">
                            {step.key !== "incidencias" && (<div className="grid grid-cols-2 gap-3"><Field label="Fecha inicio"><Inp type="date" value={d.dateStart||""} onChange={e=>upd(item.id,step.key,{dateStart:e.target.value})} disabled={!editable}/></Field><Field label="Fecha fin"><Inp type="date" value={d.date||d.doneAt||""} onChange={e=>upd(item.id,step.key,{date:e.target.value})} disabled={!editable}/></Field></div>)}
                            {step.hasTimer && editable && <div><p className="text-xs font-semibold text-slate-500 mb-1.5">Registro de tiempo</p><Timer totalSeconds={d.totalSeconds||0} running={d.running||false} startTs={d.startTs||null} log={d.log||[]} disabled={false} session={session} onUpdate={v=>upd(item.id,step.key,v)}/></div>}
                            {step.key === "diseno" && <div><p className="text-xs font-semibold text-slate-500 mb-1.5">Archivos de diseño</p><FileAttachList files={d.files||[]} disabled={!editable} accent="pink" onAdd={f=>upd(item.id,step.key,{files:[...(d.files||[]),f]})} onRemove={i=>upd(item.id,step.key,{files:(d.files||[]).filter((_,j)=>j!==i)})}/></div>}
                            {step.key === "compras" && <div><p className="text-xs font-semibold text-slate-500 mb-1.5">Líneas de compra</p><ComprasLines lines={d.lines||[]} disabled={!editable} onUpdate={lines=>upd(item.id,step.key,{lines})} providers={providers}/></div>}
                            {step.key === "acabado" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><Field label="Descripción"><Inp value={d.what||""} onChange={e=>upd(item.id,step.key,{what:e.target.value})} disabled={!editable} placeholder="Tipo/color/acabado"/></Field><Field label="Nº pedido acabado"><Inp value={d.orderNum||""} onChange={e=>upd(item.id,step.key,{orderNum:e.target.value})} disabled={!editable} placeholder="Nº"/></Field></div>}
                            {(step.key==="soldadura"||step.key==="cnc"||step.key==="calidad"||step.key==="embalaje")&&<Field label="Fotos"><Photos photos={d.photos||[]} disabled={!editable} onAdd={ph=>upd(item.id,step.key,{photos:[...(d.photos||[]),ph]})} onRemove={i=>upd(item.id,step.key,{photos:(d.photos||[]).filter((_,j)=>j!==i)})}/></Field>}
                            {step.key === "montaje" && <div className="space-y-3"><div><p className="text-xs font-semibold text-slate-500 mb-2">Checks</p><Checks checks={d.checks||{}} onUpdate={checks=>upd(item.id,step.key,{checks})} disabled={!editable}/></div><Field label="Fotos"><Photos photos={d.photos||[]} disabled={!editable} onAdd={ph=>upd(item.id,step.key,{photos:[...(d.photos||[]),ph]})} onRemove={i=>upd(item.id,step.key,{photos:(d.photos||[]).filter((_,j)=>j!==i)})}/></Field></div>}
                            {step.key === "incidencias" && <IncidenciasPanel entries={d.entries||[]} onAdd={async entry => { const stepId = item.id + "_incidencias"; await db.addIncident({...entry, itemStepId: stepId}); upd(item.id, step.key, {entries:[...(d.entries||[]),entry]}); }} session={session} incidentTypes={incidentTypes}/>}
                            {step.key !== "incidencias" && <div className="border-t border-slate-200/60 pt-3"><CommentBox comments={d.comments||[]} onAdd={c=>addStepCmt(item.id,step.key,c)} session={session}/></div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── OrderForm ────────────────────────────────────────────────────────────────
function OrderForm({order,operarios,catalog,onSave,onCancel,clients}){
  const [form,setForm]=useState(order||{number:"",client:"",clientId:null,clientContact:"",clientPublicidad:false,ref:"",dateStart:"",dateEnd:"",assignedUsers:[],items:[],comments:[],files:[]});
  const set_=(k,v)=>setForm(f=>({...f,[k]:v}));
  const toggleUser=uid=>{const a=form.assignedUsers||[];set_("assignedUsers",a.includes(uid)?a.filter(x=>x!==uid):[...a,uid]);};
  const [catModal,setCatModal]=useState(false);
  const [newCatItem,setNewCatItem]=useState(false);
const addFromCatalog=entry=>{
  const newItem=blankItem(entry);
  setForm(prev=>{
    const newItems=[...(prev.items||[]),newItem];
    // Auto-assign users
    const enabledSteps=Object.keys(newItem).filter(k=>newItem[k]?.enabled&&k!=="incidencias");
    const stepToRole={diseno:"diseno",compras:"compras",soldadura:"soldadura",cnc:"cnc",montaje:"montaje",calidad:"calidad",embalaje:"embalaje"};
    const neededRoles=enabledSteps.map(k=>stepToRole[k]).filter(Boolean);
    const autoUsers=operarios.filter(u=>neededRoles.includes(u.role)).map(u=>u.id);
    const currentAssigned=prev.assignedUsers||[];
    const merged=[...new Set([...currentAssigned,...autoUsers])];
    // Recalculate ALL dates with the new item included
    const withDates=autoPlanOrderFromCatalog({...prev,items:newItems,assignedUsers:merged},catalog);
    return withDates;
  });
  setCatModal(false);
};
  const addBlank=()=>set_("items",[...(form.items||[]),blankItem()]);
const toggleStep=(itemId,stepKey)=>{setForm(prev=>({...prev,items:(prev.items||[]).map(it=>{if(it.id!==itemId)return it;const enabled=!it[stepKey]?.enabled;return{...it,[stepKey]:{...(it[stepKey]||{}),enabled:enabled}};})}));};
  const tipos=[...new Set(catalog.map(i=>i.tipo))].sort();
  return(<div className="space-y-5">
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Nº de pedido *"><Inp value={form.number} onChange={e=>set_("number",e.target.value)} placeholder="ej. 2024-001"/></Field>
      <Field label="Cliente *">
        {clients&&clients.length>0
          ? <Sel value={form.clientId||""} onChange={e=>{const id=e.target.value;const c=(clients||[]).find(x=>x.id===id);setForm(f=>!c?{...f,clientId:null}:{...f,clientId:id,client:c.name,clientContact:c.contact||"",clientPublicidad:!!c.publicidad});}}>
              <option value="">— Selecciona cliente —</option>
              {(clients||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </Sel>
          : <Inp value={form.client} onChange={e=>set_("client",e.target.value)} placeholder="Nombre del cliente"/>
        }
      </Field>
      <Field label="Referencia"><Inp value={form.ref} onChange={e=>set_("ref",e.target.value)} placeholder="Referencia interna"/></Field>
      <div/>
      <Field label="Fecha inicial"><Inp type="date" value={form.dateStart} onChange={e=>set_("dateStart",e.target.value)}/></Field>
      <Field label="Fecha de entrega"><Inp type="date" value={form.dateEnd} onChange={e=>set_("dateEnd",e.target.value)}/></Field>
    </div>
    <Field label="Operarios asignados"><div className="flex flex-wrap gap-2">{operarios.map(u=><button key={u.id} type="button" onClick={()=>toggleUser(u.id)} className={"flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold transition-all "+((form.assignedUsers||[]).includes(u.id)?({soldadura:"bg-orange-100 border-orange-300 text-orange-700",montaje:"bg-blue-100 border-blue-300 text-blue-700",diseno:"bg-pink-100 border-pink-300 text-pink-700",compras:"bg-amber-100 border-amber-300 text-amber-700",cnc:"bg-cyan-100 border-cyan-300 text-cyan-700",calidad:"bg-emerald-100 border-emerald-300 text-emerald-700",embalaje:"bg-indigo-100 border-indigo-300 text-indigo-700"}[u.role]||"bg-indigo-100 border-indigo-300 text-indigo-700"):"bg-white border-slate-200 text-slate-500 hover:border-slate-300")}>{(form.assignedUsers||[]).includes(u.id)&&<Icon name="check" size={12}/>}{u.name}</button>)}</div></Field>
    <div>
      <div className="flex items-center justify-between mb-3"><h3 className="font-bold text-slate-800">Artículos</h3><div className="flex gap-2"><Btn variant="secondary" size="sm" onClick={()=>setCatModal(true)}><Icon name="book" size={13}/>Del catálogo</Btn><Btn variant="secondary" size="sm" onClick={addBlank}><Icon name="plus" size={13}/>Artículo libre</Btn></div></div>
      {(!form.items||form.items.length===0)&&<p className="text-slate-400 text-sm text-center py-6 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">Añade artículos del catálogo o crea uno libre</p>}
      <div className="space-y-3">{(form.items||[]).map((item,idx)=>(<div key={item.id} className="border border-slate-200 rounded-xl p-4 bg-slate-50"><div className="flex items-center gap-3 mb-3"><span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center flex-shrink-0">{idx+1}</span><div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2"><Inp value={item.name} onChange={e=>set_("items",(form.items||[]).map(it=>it.id===item.id?{...it,name:e.target.value}:it))} placeholder="Nombre del artículo"/><Inp value={item.catalogRef||""} onChange={e=>set_("items",(form.items||[]).map(it=>it.id===item.id?{...it,catalogRef:e.target.value}:it))} placeholder="Referencia (opcional)"/></div><button onClick={()=>set_("items",(form.items||[]).filter(it=>it.id!==item.id))} className="text-red-400 hover:text-red-600"><Icon name="trash" size={15}/></button></div><div className="flex flex-wrap gap-2">{ALL_STEPS.map(step=><button key={step.key} type="button" onClick={()=>toggleStep(item.id,step.key)} className={"flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-all "+(item[step.key]?.enabled?"bg-indigo-100 border-indigo-300 text-indigo-700":"bg-white border-slate-200 text-slate-400 hover:border-slate-300")}>{item[step.key]?.enabled&&<Icon name="check" size={10}/>}{step.label}</button>)}</div></div>))}</div>
    </div>
    <div className="flex justify-end gap-3 pt-2 border-t border-slate-100"><Btn variant="secondary" onClick={onCancel}>Cancelar</Btn><Btn onClick={()=>{if(!form.number||!form.client){alert("Número y cliente obligatorios");return;}onSave(form);}}><Icon name="check" size={15}/>Guardar</Btn></div>
    <Modal open={catModal} onClose={()=>setCatModal(false)} title="Elegir del catálogo" size="lg">
      <div className="space-y-4">{[...new Set(catalog.map(i=>i.tipo))].sort().map(tipo=>{const lineas=[...new Set(catalog.filter(i=>i.tipo===tipo).map(i=>i.linea))].sort();return(<div key={tipo}><h3 className="font-bold text-slate-700 mb-2">{tipo}</h3>{lineas.map(linea=>{const arts=catalog.filter(i=>i.tipo===tipo&&i.linea===linea);return(<div key={linea} className="ml-4 mb-3"><p className="text-xs font-bold text-slate-400 mb-1.5">{linea}</p><div className="grid grid-cols-1 sm:grid-cols-2 gap-2 ml-3">{arts.map(art=><button key={art.id} onClick={()=>addFromCatalog(art)} className="text-left bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 rounded-xl px-3 py-2.5 transition-all"><div className="font-semibold text-slate-800 text-sm">{art.articulo}</div>{art.ref&&<div className="text-xs text-slate-400">{art.ref}</div>}</button>)}</div></div>);})} </div>);})}
      {catalog.length===0&&<p className="text-slate-400 text-center py-8">El catálogo está vacío.</p>}
      </div>
    </Modal>
  </div>);
}

// ─── OrdersView ───────────────────────────────────────────────────────────────
function OrdersView({orders, allOrders, users, session, isAdmin, archived, onSaveOrders, onDeleteOrder, jumpTo, onJumpHandled, catalog, incidentTypes, clients, providers, onRefreshOrder}) {
  const [showForm,setShowForm]=useState(false);const [editOrder,setEditOrder]=useState(null);const [detail,setDetail]=useState(null);const [loadingDetail,setLoadingDetail]=useState(false);const [gantt,setGantt]=useState(null);const [search,setSearch]=useState("");const [zipping,setZipping]=useState(null);const [showDone,setShowDone]=useState(false);

  const openDetail = async (order) => {
    setLoadingDetail(true);
    const full = await loadFullOrder(order.id);
    setDetail(full || order);
    setLoadingDetail(false);
  };

  useEffect(()=>{if(jumpTo){const o=allOrders.find(x=>x.id===jumpTo);if(o)openDetail(o);onJumpHandled();}},[jumpTo]);

  const filtered=orders.filter(o=>{
    const q=search.toLowerCase();
    const matchSearch=!q||(o.number||"").toLowerCase().includes(q)||(o.client||"").toLowerCase().includes(q)||(o.ref||"").toLowerCase().includes(q);
    if(!matchSearch)return false;
    if(isAdmin||showDone)return true;
    if(session.role==="diseno"||session.role==="compras"){const myVisibleSteps=ROLE_VISIBLE[session.role]||[];return(o.items||[]).some(item=>myVisibleSteps.some(sk=>item[sk]?.enabled));}
    if(!o.released)return false;
    const assignedToMe=(o.assignedUsers||[]).includes(session.id);
    if(!assignedToMe)return false;
    return(o.items||[]).some(item=>!isItemDoneForRole(item,session.role));
  }).sort((a,b)=>{const da=a.dateEnd||"9999",db=b.dateEnd||"9999";return da<db?-1:da>db?1:0;});

  const getProgress=o=>{let total=0,done=0;(o.items||[]).forEach(item=>ALL_STEPS.forEach(s=>{if(item[s.key]?.enabled){total++;if(item[s.key].done)done++;}}));return total?Math.round((done/total)*100):0;};

  const handleSave = async (order) => {
    const baseOrder = order.id ? order : autoPlanOrderFromCatalog(order, catalog);
    const newOrder = { ...baseOrder, id: baseOrder.id || Date.now() + "", archived: false, released: false, createdAt: baseOrder.createdAt || new Date().toISOString() };
    await saveFullOrder(newOrder);
    await onSaveOrders(); // refresh list
    setShowForm(false); setEditOrder(null);
  };

  const handleArchive = async (id) => {
    const order = allOrders.find(o => o.id === id) || orders.find(o => o.id === id);
    if (!order) return;
    const isArchiving = !order.archived;
    if (isArchiving) {
      setZipping(id);
      try { const full=await loadFullOrder(order.id); await genZip(full||order, users); } catch(e){console.error(e);}
      setZipping(null);
    }
    await db.patchOrder(id, { archived: isArchiving });
    await onSaveOrders();
  };

  const handleRelease = async (id, released) => {
    await db.patchOrder(id, { released });
    await onSaveOrders();
  };

  const handleDelete = async (id) => {
    if (!confirm("¿Eliminar pedido?")) return;
    await db.deleteOrder(id);
    await onSaveOrders();
  };

  const updateDetail = async (updated) => {
    // Header-level changes
    await db.upsertOrderHeader(updated);
    await onSaveOrders();
    setDetail(updated);
  };

  return(<div>
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
      <div><h1 className="text-2xl font-black text-slate-800">{archived?"Archivados":"Pedidos de fabricación"}</h1><p className="text-slate-500 text-sm">{filtered.length} pedido{filtered.length!==1?"s":""}</p></div>
      <div className="flex items-center gap-3 flex-wrap">
        {!isAdmin&&!archived&&<button onClick={()=>setShowDone(v=>!v)} className={"flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold transition-all "+(showDone?"bg-indigo-100 border-indigo-300 text-indigo-700":"bg-white border-slate-200 text-slate-500 hover:border-slate-300")}><Icon name="filter" size={14}/>{showDone?"Ver todos":"Solo pendientes"}</button>}
        <Inp placeholder="Buscar…" value={search} onChange={e=>setSearch(e.target.value)} className="w-44"/>
        {isAdmin&&!archived&&<Btn onClick={()=>{setEditOrder(null);setShowForm(true);}}><Icon name="plus" size={16}/>Nuevo pedido</Btn>}
      </div>
    </div>
    {filtered.length===0
      ? <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center"><p className="text-slate-500 font-medium">No hay pedidos{search?" que coincidan":""}</p></div>
      : <div className="space-y-3">{filtered.map(order=>{
          const p=getProgress(order);const incN=(order.items||[]).reduce((acc,item)=>acc+((item.incidencias?.enabled&&item.incidencias?.entries?.length)||0),0);const totalSecs=orderTotalSecs(order);
          return(<div key={order.id} className={"bg-white rounded-2xl border hover:shadow-md transition-all p-5 "+(order.released?"border-slate-200 hover:border-indigo-200":"border-dashed border-slate-300 opacity-75")}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {isAdmin&&<button onClick={()=>handleRelease(order.id,!order.released)} title={order.released?"Ocultar":"Liberar"} className={"w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all "+(order.released?"bg-indigo-600 border-indigo-600 text-white":"bg-white border-slate-300 hover:border-indigo-400")}>{order.released&&<Icon name="check" size={12}/>}</button>}
                  <span className="font-black text-slate-800 text-base">#{order.number}</span><span className="text-slate-300">·</span><span className="font-semibold text-slate-700">{order.client}</span>
                  {isAdmin&&!order.released&&<Badge color="gray">Oculto</Badge>}
                  {p===100?<Badge color="green">Completado</Badge>:p>0?<Badge color="blue">En progreso {p}%</Badge>:<Badge color="gray">Pendiente</Badge>}
                  {incN>0&&<Badge color="red">{incN} incid.</Badge>}
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                  {order.ref&&<span>Ref: <b className="text-slate-700">{order.ref}</b></span>}
                  {order.dateStart&&<span>Inicio: <b className="text-slate-700">{order.dateStart}</b></span>}
                  {order.dateEnd&&<span>Entrega: <b className="text-slate-700">{order.dateEnd}</b><span className="inline-flex items-center bg-indigo-100 text-indigo-700 font-bold rounded px-1.5 py-0.5 ml-1">S{weekNum(new Date(order.dateEnd))}</span></span>}
                  <span>{(order.items||[]).length} artículo{(order.items||[]).length!==1?"s":""}</span>
                  {totalSecs>0&&<span className="flex items-center gap-1 font-mono font-bold text-slate-600 bg-slate-100 rounded px-1.5 py-0.5"><Icon name="clock" size={10}/>{fmtTShort(totalSecs)}</span>}
                </div>
                <div className="flex flex-wrap gap-1 mt-2">{(order.assignedUsers||[]).map(uid=>{const u=users.find(x=>x.id===uid);return u?<Badge key={uid} color={roleColor(u.role)}>{u.name}</Badge>:null;})}</div>
              </div>
              <div className="sm:w-28"><div className="flex justify-between text-xs text-slate-500 mb-1"><span>Progreso</span><b>{p}%</b></div><div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full transition-all" style={{width:p+"%",background:p===100?"#10b981":"#6366f1"}}/></div></div>
              <div className="flex items-center gap-1 flex-wrap">
                <Btn variant="ghost" size="sm" onClick={()=>openDetail(order)} disabled={loadingDetail}><Icon name="eye" size={14}/>{loadingDetail?"…":"Ver"}</Btn>
                <Btn variant="ghost" size="sm" onClick={async()=>{const full=await loadFullOrder(order.id);setGantt(full||order);}} title="Gantt"><Icon name="gantt" size={14}/></Btn>
                {isAdmin&&<><Btn variant="ghost" size="sm" onClick={async()=>{const full=await loadFullOrder(order.id);setEditOrder(full||order);setShowForm(true);}}><Icon name="edit" size={14}/></Btn><Btn variant="ghost" size="sm" disabled={!!zipping} onClick={()=>handleArchive(order.id)}>{zipping===order.id?<span className="text-xs animate-pulse">ZIP…</span>:<Icon name="archive" size={14}/>}</Btn><Btn variant="danger" size="sm" onClick={()=>handleDelete(order.id)}><Icon name="trash" size={14}/></Btn></>}
              </div>
            </div>
          </div>);
        })}</div>
    }
    <Modal open={showForm} onClose={()=>{setShowForm(false);setEditOrder(null);}} title={editOrder?"Editar pedido":"Nuevo pedido"} size="lg">{showForm&&<OrderForm order={editOrder} operarios={users.filter(u=>u.role!=="admin")} catalog={catalog} onSave={handleSave} onCancel={()=>{setShowForm(false);setEditOrder(null);}} clients={clients}/>}</Modal>
    <Modal open={!!detail} onClose={()=>setDetail(null)} title={detail?`#${detail.number} — ${detail.client}`:""} size="xl">{detail&&<OrderDetail order={detail} users={users} session={session} isAdmin={isAdmin} onUpdate={updateDetail} incidentTypes={incidentTypes} showDone={showDone} providers={providers} clients={clients}/>}</Modal>
    <Modal open={!!gantt} onClose={()=>setGantt(null)} title={gantt?`Gantt — #${gantt.number} · ${gantt.client}`:""} size="full">{gantt&&<GanttChart order={gantt}/>}</Modal>
  </div>);
}

// ─── UsersView ────────────────────────────────────────────────────────────────
function QRModal({user,onClose}){const url=window.location.origin+window.location.pathname+"?token="+user.token;const qrUrl="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data="+encodeURIComponent(url);return(<Modal open={true} onClose={onClose} title={"QR — "+user.name} size="sm"><div className="flex flex-col items-center gap-4 py-2"><img src={qrUrl} alt="QR" className="rounded-xl border border-slate-200 shadow"/><p className="text-xs text-slate-500 text-center">Escanear para acceder como <b>{user.name}</b></p><Btn variant="secondary" onClick={()=>navigator.clipboard.writeText(url)}>Copiar enlace</Btn></div></Modal>);}

function UsersView({users,session,onSaveUsers}){
  const [showForm,setShowForm]=useState(false);const [editUser,setEditUser]=useState(null);const [form,setForm]=useState({name:"",username:"",password:"",role:"soldadura"});const [qrUser,setQrUser]=useState(null);
  const openEdit=u=>{setForm({...u});setEditUser(u);setShowForm(true);};
  const genToken=()=>"tok-"+Math.random().toString(36).slice(2,10)+"-"+Date.now().toString(36);
  const save=async()=>{if(!form.name||!form.username||(!editUser&&!form.password)){alert("Completa todos los campos");return;}const user=editUser?{...editUser,...form}:{...form,id:Date.now()+"",token:genToken()};await db.upsertUser(user);onSaveUsers(editUser?users.map(u=>u.id===editUser.id?user:u):[...users,user]);setShowForm(false);};
  const del=async u=>{if(!confirm("¿Eliminar?"))return;await db.deleteUser(u.id);onSaveUsers(users.filter(x=>x.id!==u.id));};
  const ri={admin:{label:"Admin",color:"purple"},soldadura:{label:"Soldadura",color:"orange"},montaje:{label:"Montaje",color:"blue"},diseno:{label:"Diseño",color:"pink"},compras:{label:"Compras",color:"amber"},cnc:{label:"CNC",color:"cyan"},calidad:{label:"Calidad",color:"green"},embalaje:{label:"Embalaje",color:"indigo"}};
  return(<div><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6"><div><h1 className="text-2xl font-black text-slate-800">Usuarios</h1><p className="text-slate-500 text-sm">{users.length} usuario{users.length!==1?"s":""}</p></div>{session.role==="admin"&&<Btn onClick={()=>{setForm({name:"",username:"",password:"",role:"soldadura"});setEditUser(null);setShowForm(true);}}><Icon name="plus" size={16}/>Nuevo usuario</Btn>}</div><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{users.map(u=>(<div key={u.id} className={"bg-white rounded-2xl border p-5 flex flex-col gap-3 "+(u.id===session.id?"border-indigo-300 ring-2 ring-indigo-100":"border-slate-200")}><div className="flex items-center gap-3"><div className={"w-10 h-10 rounded-full flex items-center justify-center text-base font-black "+({"admin":"bg-violet-100 text-violet-700","soldadura":"bg-orange-100 text-orange-700","montaje":"bg-blue-100 text-blue-700","diseno":"bg-pink-100 text-pink-700","compras":"bg-amber-100 text-amber-700","cnc":"bg-cyan-100 text-cyan-700","calidad":"bg-emerald-100 text-emerald-700","embalaje":"bg-indigo-100 text-indigo-700"}[u.role]||"bg-slate-100 text-slate-600")}>{u.name[0]}</div><div className="flex-1 min-w-0"><p className="font-bold text-slate-800 truncate">{u.name}</p><p className="text-xs text-slate-400">@{u.username}</p></div><Badge color={ri[u.role]?.color||"gray"}>{ri[u.role]?.label||u.role}</Badge></div>{u.id===session.id&&<p className="text-xs text-indigo-500 font-semibold">— Sesión actual</p>}<div className="flex gap-2 pt-1 border-t border-slate-100">{session.role==="admin"&&<><Btn variant="ghost" size="sm" onClick={()=>openEdit(u)}><Icon name="edit" size={13}/>Editar</Btn><Btn variant="ghost" size="sm" onClick={()=>setQrUser(u)}><Icon name="qr" size={13}/>QR</Btn>{u.id!==session.id&&<Btn variant="danger" size="sm" onClick={()=>del(u)}><Icon name="trash" size={13}/></Btn>}</>}</div></div>))}</div>
  <Modal open={showForm} onClose={()=>setShowForm(false)} title={editUser?"Editar usuario":"Nuevo usuario"} size="sm">{showForm&&(<div className="space-y-4"><Field label="Nombre completo"><Inp value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="ej. Carlos Ruiz"/></Field><Field label="Usuario"><Inp value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))} placeholder="ej. soldador1"/></Field><Field label={editUser?"Nueva contraseña (dejar vacío para no cambiar)":"Contraseña"}><Inp type="password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder="••••••"/></Field><Field label="Rol"><Sel value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}><option value="admin">Administrador</option><option value="diseno">Diseño</option><option value="compras">Compras</option><option value="soldadura">Soldadura</option><option value="cnc">CNC</option><option value="montaje">Montaje</option><option value="calidad">Calidad</option><option value="embalaje">Embalaje</option></Sel></Field><div className="flex justify-end gap-3 pt-2"><Btn variant="secondary" onClick={()=>setShowForm(false)}>Cancelar</Btn><Btn onClick={save}><Icon name="check" size={15}/>Guardar</Btn></div></div>)}</Modal>
  {qrUser&&<QRModal user={qrUser} onClose={()=>setQrUser(null)}/>}</div>);
}

// ─── ClientsView ──────────────────────────────────────────────────────────────
function ClientsView({clients,onSave}){
  const [form,setForm]=useState(null);
  const save=async()=>{const c=form.id?clients.map(x=>x.id===form.id?form:x):[...clients,{...form,id:Date.now()+""}];await db.upsertClient(form.id?form:{...form,id:Date.now()+""});onSave(c);setForm(null);};
  const del=async id=>{if(!confirm("¿Eliminar?"))return;await db.deleteClient(id);onSave(clients.filter(x=>x.id!==id));};
  const blank=()=>({id:null,name:"",contact:"",publicidad:false,extra:""});
  return(<div><div className="flex items-center justify-between mb-6"><div><h1 className="text-2xl font-black text-slate-800">Clientes</h1><p className="text-slate-500 text-sm">{clients.length} cliente{clients.length!==1?"s":""}</p></div><Btn onClick={()=>setForm(blank())}><Icon name="plus" size={16}/>Nuevo cliente</Btn></div>
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{clients.map(c=>(<div key={c.id} className="bg-white rounded-2xl border border-slate-200 p-5"><div className="flex items-start justify-between gap-2 mb-3"><div><p className="font-bold text-slate-800">{c.name}</p>{c.contact&&<p className="text-xs text-slate-400 mt-0.5">{c.contact}</p>}</div><div className="flex gap-1"><Btn variant="ghost" size="sm" onClick={()=>setForm({...c})}><Icon name="edit" size={13}/></Btn><Btn variant="danger" size="sm" onClick={()=>del(c.id)}><Icon name="trash" size={13}/></Btn></div></div><div className="flex gap-2 flex-wrap">{c.publicidad&&<Badge color="pink">Publicidad</Badge>}{c.extra&&<span className="text-xs text-slate-500">{c.extra}</span>}</div></div>))}</div>
  {clients.length===0&&<div className="text-center py-16 text-slate-400"><Icon name="users" size={36}/><p className="mt-3 text-sm font-medium">No hay clientes</p></div>}
  <Modal open={!!form} onClose={()=>setForm(null)} title={form?.id?"Editar cliente":"Nuevo cliente"} size="sm">{form&&(<div className="space-y-4"><Field label="Nombre *"><Inp value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Nombre del cliente"/></Field><Field label="Contacto"><Inp value={form.contact||""} onChange={e=>setForm(f=>({...f,contact:e.target.value}))} placeholder="email / teléfono"/></Field><Field label="Notas"><Inp value={form.extra||""} onChange={e=>setForm(f=>({...f,extra:e.target.value}))} placeholder="Notas adicionales"/></Field><div className="flex items-center gap-3"><Tog on={!!form.publicidad} onClick={()=>setForm(f=>({...f,publicidad:!f.publicidad}))}/><span className="text-sm font-semibold text-slate-700">Incluye publicidad</span></div><div className="flex justify-end gap-3 pt-2"><Btn variant="secondary" onClick={()=>setForm(null)}>Cancelar</Btn><Btn onClick={()=>{if(!form.name){alert("Nombre obligatorio");return;}save();}}><Icon name="check" size={15}/>Guardar</Btn></div></div>)}</Modal></div>);
}

// ─── ProvidersView ────────────────────────────────────────────────────────────
function ProvidersView({providers,onSave}){
  const [form,setForm]=useState(null);
  const save=async()=>{const id=form.id||Date.now()+"";const p={...form,id};await db.upsertProvider({...p,leadDays:parseInt(p.leadDays,10)||0});onSave(form.id?providers.map(x=>x.id===form.id?p:x):[...providers,p]);setForm(null);};
  const del=async id=>{if(!confirm("¿Eliminar?"))return;await db.deleteProvider(id);onSave(providers.filter(x=>x.id!==id));};
  return(<div><div className="flex items-center justify-between mb-6"><div><h1 className="text-2xl font-black text-slate-800">Proveedores</h1><p className="text-slate-500 text-sm">{providers.length} proveedor{providers.length!==1?"es":""}</p></div><Btn onClick={()=>setForm({id:null,name:"",contact:"",leadDays:0})}><Icon name="plus" size={16}/>Nuevo proveedor</Btn></div>
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{providers.map(p=>(<div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-5"><div className="flex items-start justify-between gap-2 mb-2"><div><p className="font-bold text-slate-800">{p.name}</p>{p.contact&&<p className="text-xs text-slate-400 mt-0.5">{p.contact}</p>}</div><div className="flex gap-1"><Btn variant="ghost" size="sm" onClick={()=>setForm({...p})}><Icon name="edit" size={13}/></Btn><Btn variant="danger" size="sm" onClick={()=>del(p.id)}><Icon name="trash" size={13}/></Btn></div></div>{p.leadDays>0&&<Badge color="amber">Plazo: {p.leadDays} días</Badge>}</div>))}</div>
  {providers.length===0&&<div className="text-center py-16 text-slate-400"><Icon name="shopping" size={36}/><p className="mt-3 text-sm font-medium">No hay proveedores</p></div>}
  <Modal open={!!form} onClose={()=>setForm(null)} title={form?.id?"Editar proveedor":"Nuevo proveedor"} size="sm">{form&&(<div className="space-y-4"><Field label="Nombre *"><Inp value={form.name||""} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Nombre del proveedor"/></Field><Field label="Contacto"><Inp value={form.contact||""} onChange={e=>setForm(f=>({...f,contact:e.target.value}))} placeholder="email / teléfono"/></Field><Field label="Plazo de entrega (días)"><Inp type="number" min="0" value={form.leadDays||0} onChange={e=>setForm(f=>({...f,leadDays:e.target.value}))}/></Field><div className="flex justify-end gap-3 pt-2"><Btn variant="secondary" onClick={()=>setForm(null)}>Cancelar</Btn><Btn onClick={()=>{if(!form.name){alert("Nombre obligatorio");return;}save();}}><Icon name="check" size={15}/>Guardar</Btn></div></div>)}</Modal></div>);
}

// ─── Login ────────────────────────────────────────────────────────────────────
function Login({onLogin,users}){
  const [u,setU]=useState("");const [p,setP]=useState("");const [err,setErr]=useState("");const [loading,setLoading]=useState(false);
  const submit=async()=>{
    setLoading(true);setErr("");
    // Try token from URL first
    const params=new URLSearchParams(window.location.search);
    const token=params.get("token");
    if(token){const user=users.find(x=>x.token===token);if(user){onLogin(user);return;}}
    const user=users.find(x=>x.username===u.trim()&&x.password===p);
    if(user){onLogin(user);}else{setErr("Usuario o contraseña incorrectos");}
    setLoading(false);
  };
  // Auto-login via token on mount
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const token=params.get("token");
    if(token&&users.length){const user=users.find(x=>x.token===token);if(user)onLogin(user);}
  },[users]);
  return(<div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 flex items-center justify-center p-4"><div className="w-full max-w-sm"><div className="text-center mb-8"><div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-900/50"><Icon name="wrench" size={28}/></div><h1 className="text-2xl font-black text-white">Levipark</h1><p className="text-indigo-300 text-sm mt-1">Gestión de fabricación</p></div><div className="bg-white/10 backdrop-blur rounded-2xl p-6 border border-white/20 shadow-xl space-y-4"><Field label={<span className="text-indigo-200 text-sm font-semibold">Usuario</span>}><Inp value={u} onChange={e=>{setU(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="usuario" className="bg-white/10 border-white/20 text-white placeholder-white/30 focus:ring-indigo-400"/></Field><Field label={<span className="text-indigo-200 text-sm font-semibold">Contraseña</span>}><Inp type="password" value={p} onChange={e=>{setP(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="••••••" className="bg-white/10 border-white/20 text-white placeholder-white/30 focus:ring-indigo-400"/></Field>{err&&<p className="text-red-300 text-sm font-medium text-center">{err}</p>}<button onClick={submit} disabled={loading||!u||!p} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-all shadow-lg">{loading?"Accediendo…":"Entrar"}</button></div></div></div>);
}

// ─── MainApp ──────────────────────────────────────────────────────────────────
function CalendarViewLoader({orders, users, session, isAdmin, onOrderClick}){
  const [loaded, setLoaded] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    async function load(){
      setLoading(true);
      const full = await Promise.all(orders.map(o => loadFullOrder(o.id)));
      setLoaded(full.filter(Boolean));
      setLoading(false);
    }
    load();
  }, [orders.map(o=>o.id).join(",")]);

  if(loading) return(
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-indigo-400 border-t-transparent rounded-full animate-spin"/>
    </div>
  );

  return <CalendarView orders={loaded} users={users} session={session} isAdmin={isAdmin} onOrderClick={onOrderClick}/>;
}

function GanttAllView({orders}){
  const [loaded,setLoaded]=useState([]);
  useEffect(()=>{
    async function load(){
      const full=await Promise.all(orders.map(o=>loadFullOrder(o.id)));
      setLoaded(full.filter(Boolean));
    }
    load();
  },[orders.map(o=>o.id).join(",")]);
  if(!loaded.length)return<div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-indigo-400 border-t-transparent rounded-full animate-spin"/></div>;
  return(<div><h1 className="text-2xl font-black text-slate-800 mb-6">Gantt global</h1><div className="space-y-6">{loaded.map(o=><div key={o.id} className="bg-white rounded-2xl border border-slate-200 p-6"><h2 className="font-bold text-slate-800 mb-4">#{o.number} — {o.client}{o.ref?" · "+o.ref:""}</h2><GanttChart order={o}/></div>)}</div></div>);
}

function MainApp(){
  const [session,setSession]=useState(null);
  const [view,setView]=useState("orders");
  const [users,setUsers]=useState([]);
  const [orders,setOrders]=useState([]);
  const [catalog,setCatalog]=useState([]);
  const [clients,setClients]=useState([]);
  const [providers,setProviders]=useState([]);
  const [incidentTypes,setIncidentTypes]=useState(DEFAULT_INCIDENT_TYPES);
  const [loading,setLoading]=useState(true);
  const [jumpTo,setJumpTo]=useState(null);
  const [showMigration,setShowMigration]=useState(false);

  const loadAll=useCallback(async()=>{
    setLoading(true);
    const [u,o,cat,cli,prov,inc]=await Promise.all([
      db.getUsers(),
      db.getOrders(),
      db.getCatalog(),
      db.getClients(),
      db.getProviders(),
      db.getIncidentTypes(),
    ]);
    setUsers(u.length?u:INIT_USERS);
    setOrders(o);
    setCatalog(cat.length?cat:INIT_CATALOG);
    setClients(cli.length?cli:INIT_CLIENTS);
    setProviders(prov.length?prov:INIT_PROVIDERS);
    setIncidentTypes(inc||DEFAULT_INCIDENT_TYPES);
    setLoading(false);
  },[]);

  useEffect(()=>{loadAll();},[loadAll]);

  // Auto-login via token
  useEffect(()=>{
    if(!users.length)return;
    const params=new URLSearchParams(window.location.search);
    const token=params.get("token");
    if(token){const user=users.find(x=>x.token===token);if(user&&!session){setSession(user);return;}}
    const savedId=sessionStorage.getItem("fab_session");
    if(savedId&&!session){const user=users.find(x=>x.id===savedId);if(user)setSession(user);}
  },[users]);

  const isAdmin=session?.role==="admin";

  const [fullOrders, setFullOrders] = useState([]);

useEffect(()=>{
  async function loadFull(){
    const full = await Promise.all(orders.map(o => loadFullOrder(o.id)));
    setFullOrders(full.filter(Boolean));
  }
  if(orders.length) loadFull();
  else setFullOrders([]);
},[orders.map(o=>o.id).join(",")]);

const vis=useMemo(()=>fullOrders.filter(o=>isOrderVisibleForSession(o,session||{role:""},view==="archived"?"archived":"active")),[fullOrders,session,view]);

  const handleLogin=user=>{
  setSession(user);
  setView("orders");
  sessionStorage.setItem("fab_session", user.id);
  };
  const handleLogout=()=>{setSession(null);setView("orders");sessionStorage.removeItem("fab_session");window.history.replaceState({},"",window.location.pathname);};

  const refreshOrders=useCallback(async()=>{const o=await db.getOrders();setOrders(o);},[]);

  const saveCatalog=async(updated)=>{for(const item of updated)await db.upsertCatalogItem(item);setCatalog(updated);};
  const saveIncidentTypes=async(types)=>{await db.saveIncidentTypes(types);setIncidentTypes(types);};

  if(loading)return(<div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 flex items-center justify-center"><div className="text-center"><div className="w-12 h-12 border-4 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"/><p className="text-indigo-300 font-semibold">Cargando…</p></div></div>);
  if(!session)return<Login onLogin={handleLogin} users={users}/>;

  const NAV=[
    {id:"orders",    label:"Pedidos",    icon:"orders",  show:true},
    {id:"calendar",  label:"Calendario", icon:"calendar",show:true},
    {id:"ganttAll",  label:"Gantt",      icon:"gantt",   show:isAdmin},
    {id:"catalog",   label:"Catálogo",   icon:"book",    show:isAdmin},
    {id:"clients",   label:"Clientes",   icon:"users",   show:isAdmin},
    {id:"providers", label:"Proveedores",icon:"shopping",show:isAdmin},
    {id:"users",     label:"Usuarios",   icon:"user",    show:isAdmin},
    {id:"archived",  label:"Archivados", icon:"archive", show:isAdmin},
    {id:"settings",  label:"Config",     icon:"wrench",  show:isAdmin},
    {id:"migration", label:"Migración",  icon:"migrate", show:isAdmin},
  ].filter(n=>n.show);

  return(
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-900 flex flex-col flex-shrink-0 fixed inset-y-0 left-0 z-30">
        <div className="px-5 py-5 border-b border-slate-700/50"><div className="flex items-center gap-2.5"><div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center"><Icon name="wrench" size={16}/></div><div><p className="text-white font-black text-sm leading-tight">Levipark</p><p className="text-indigo-400 text-xs">Fabricación</p></div></div></div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">{NAV.map(n=>(<button key={n.id} onClick={()=>{setView(n.id);if(n.id==="migration")setShowMigration(true);}} className={"w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all "+(view===n.id?"bg-indigo-600 text-white shadow-lg shadow-indigo-900/30":"text-slate-400 hover:bg-slate-800 hover:text-white")}><Icon name={n.icon} size={16}/>{n.label}</button>))}</nav>
        <div className="px-3 py-4 border-t border-slate-700/50"><div className="flex items-center gap-2.5 px-2 mb-3"><div className={"w-7 h-7 rounded-full flex items-center justify-center text-xs font-black "+({admin:"bg-violet-500",soldadura:"bg-orange-500",montaje:"bg-blue-500",diseno:"bg-pink-500",compras:"bg-amber-500",cnc:"bg-cyan-500",calidad:"bg-emerald-500",embalaje:"bg-indigo-500"}[session.role]||"bg-slate-500")+" text-white"}>{session.name[0]}</div><div className="flex-1 min-w-0"><p className="text-white text-xs font-bold truncate">{session.name}</p><p className="text-slate-400 text-xs truncate">{session.role}</p></div></div><button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-sm font-semibold transition-all"><Icon name="logout" size={14}/>Cerrar sesión</button></div>
      </aside>

      {/* Main */}
      <main className="flex-1 ml-56 p-8 overflow-y-auto min-h-screen">
        {(view==="orders"||view==="archived")&&<OrdersView orders={vis} allOrders={orders} users={users} session={session} isAdmin={isAdmin} archived={view==="archived"} onSaveOrders={refreshOrders} onDeleteOrder={refreshOrders} jumpTo={jumpTo} onJumpHandled={()=>setJumpTo(null)} catalog={catalog} incidentTypes={incidentTypes} clients={clients} providers={providers} onRefreshOrder={refreshOrders}/>}
        {view==="calendar"&&<CalendarViewLoader orders={vis} users={users} session={session} isAdmin={isAdmin} onOrderClick={id=>{setJumpTo(id);setView("orders");}}/>}
        {view==="ganttAll"&&isAdmin&&<GanttAllView orders={orders.filter(o=>!o.archived)}/>}
        {view==="catalog"&&isAdmin&&<CatalogView catalog={catalog} onSave={saveCatalog} users={users}/>}
        {view==="clients"&&isAdmin&&<ClientsView clients={clients} onSave={setClients}/>}
        {view==="providers"&&isAdmin&&<ProvidersView providers={providers} onSave={setProviders}/>}
        {view==="users"&&isAdmin&&<UsersView users={users} session={session} onSaveUsers={setUsers}/>}
        {view==="settings"&&isAdmin&&<AdminSettings incidentTypes={incidentTypes} onSaveTypes={saveIncidentTypes}/>}
        {view==="migration"&&isAdmin&&<MigrationPanel onDone={()=>{setView("orders");loadAll();}}/>}
      </main>
    </div>
  );
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
const root=ReactDOM.createRoot(document.getElementById("root"));
root.render(<MainApp/>);