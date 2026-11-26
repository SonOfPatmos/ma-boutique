/* Ma Boutique — application de gestion pour la boutique de Mathias.
   Fonctionne hors ligne. Les saisies sont gardées dans le téléphone et
   envoyées vers Google Sheets quand il y a du réseau. */
(function () {
  'use strict';
  var VERSION = '1.2.1';
  var E = window.BM_ENGINE;
  var MODES = ['Espèces', 'Wave', 'OM'];
  var UNITES = ['Pièce', 'Sachet', 'Paquet', 'Bouteille', 'Cannette', 'Boîte', 'Tas', 'Kg', 'Litre', 'Plateau'];
  var CATS = ['Alimentation', 'Boisson', 'Épicerie', 'Hygiène / Entretien', 'Fruits & Légumes', 'Divers'];
  var DEPENSES = ['Transport', 'Sachets / emballages', 'Électricité', 'Eau', 'Loyer', 'Taxe / patente', 'Crédit téléphone', 'Réparation', 'Autre'];

  // ---------- Stockage ----------
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { alert('Mémoire du téléphone pleine : impossible d\'enregistrer.'); return false; } }
  var events = load('bm_events', null);
  if (!events || !events.length) { events = [window.BM_SEED]; save('bm_events', events); }
  var R = load('bm_reglages', { syncUrl: '', token: '', depart: false });
  var synced = load('bm_synced', {});
  var S = E.compute(events);
  if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) { } }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowTime() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function addEvent(ev, jour) {
    ev.id = uid(); ev.jour = jour || today(); ev.ts = ev.jour + 'T' + nowTime() + '.' + String(Date.now() % 1000).padStart(3, '0');
    if (R.appareil) ev.par = R.appareil;
    events.push(ev); save('bm_events', events); S = E.compute(events); syncSoon(); return ev;
  }

  // ---------- Format ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { n = Math.round(n || 0); var s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); return (n < 0 ? '−' : '') + s + ' F'; }
  function num(v) { v = String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'); var n = parseFloat(v); return isNaN(n) ? null : n; }
  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MOIS = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function dlong(j) { var d = new Date(j + 'T12:00:00'); var w = JOURS[d.getDay()]; return w.charAt(0).toUpperCase() + w.slice(1) + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()]; }
  function dshort(j) { if (!j) return ''; if (j === today()) return 'aujourd\'hui'; var d = new Date(j + 'T12:00:00'); return d.getDate() + ' ' + MOIS[d.getMonth()]; }
  function A(id) { return S.articles[id] || { nom: '?', unite: '', prix: 0, cmup: 0, stock: 0 }; }
  function P(id) { return S.personnes[id] || { nom: '?', solde: 0, histo: [] }; }
  function F(id) { return S.fournisseurs[id] || { nom: '' }; }

  function describe(e) {
    var m = e.mode ? ' (' + e.mode + ')' : '';
    function lignes(ls, prixKey) { return ls.map(function (l) { return l.qte + ' ' + A(l.art).nom; }).join(', '); }
    switch (e.type) {
      case 'init': return ['📂', 'Départ : données reprises du fichier Excel', ''];
      case 'credit': return ['📝', 'Crédit — ' + P(e.personne).nom + ' : ' + lignes(e.lignes), fmt(e.lignes.reduce(function (s, l) { return s + l.qte * l.prix; }, 0))];
      case 'paiement': return ['💵', P(e.personne).nom + ' a payé' + m, fmt(e.montant)];
      case 'achat': return ['🛒', 'Achat' + (e.fournisseur ? ' chez ' + F(e.fournisseur).nom : '') + ' : ' + lignes(e.lignes), fmt(e.lignes.reduce(function (s, l) { return s + l.montant; }, 0))];
      case 'comptageStock': return ['🔢', (e.depart ? 'Comptage de départ' : 'Comptage du stock') + ' (' + Object.keys(e.comptes).length + ' articles)', ''];
      case 'comptageCaisse': return ['💰', 'Comptage de l\'argent', fmt((e.esp || 0) + (e.wave || 0) + (e.om || 0))];
      case 'depense': return ['🚚', 'Dépense : ' + e.cat + (e.note ? ' — ' + e.note : '') + m, fmt(e.montant)];
      case 'perte': return ['💔', e.raison + ' : ' + lignes(e.lignes), ''];
      case 'pret': return ['🤝', 'Prêté à ' + P(e.personne).nom + m, fmt(e.montant)];
      case 'garde': return ['📥', 'Reçu de ' + P(e.personne).nom + ' (à rendre)' + m, fmt(e.montant)];
      case 'rendu': return ['📤', 'Rendu à ' + P(e.personne).nom + m, fmt(e.montant)];
      case 'soldePersonne': return ['✏️', 'Solde corrigé : ' + P(e.personne).nom, fmt(e.solde)];
      case 'paiementFournisseur': return ['🏭', 'Payé au fournisseur ' + F(e.fournisseur).nom + m, fmt(e.montant)];
      case 'prelevement': return ['👛', 'Pris pour moi' + (e.note ? ' — ' + e.note : '') + m, fmt(e.montant)];
      case 'apport': return ['➕', 'Ajouté mon argent' + m, fmt(e.montant)];
      case 'epargne': return ['🏦', (e.sens > 0 ? 'Mis de côté (épargne)' : 'Repris de l\'épargne') + m, fmt(e.montant)];
      case 'dime': return ['🙏', 'Dîme versée' + m, fmt(e.montant)];
      case 'article': return ['📦', 'Article : ' + (e.art.nom || A(e.art.id).nom), e.art.prix != null ? fmt(e.art.prix) : ''];
      case 'personne': return ['👤', 'Personne : ' + (e.p.nom || P(e.p.id).nom), ''];
      case 'fournisseur': return ['🏭', 'Fournisseur : ' + e.f.nom, ''];
      case 'reglages': return ['⚙︎', 'Réglages modifiés', ''];
      case 'annule': var r = events.filter(function (x) { return x.id === e.ref; })[0]; return ['↩︎', 'Annulation de : ' + (r && r.type !== 'annule' ? describe(r).slice(1).join(' ') + (r.par ? ' (saisi par ' + r.par + ')' : '') : '?'), ''];
    }
    return ['•', e.type, ''];
  }

  // ---------- Navigation ----------
  var view = document.getElementById('view');
  var cur = { name: 'home', p: {} };
  var form = {};
  var TITLES = { home: 'Ma Boutique', credit: 'Vente à crédit', paiement: 'On m\'a payé', achat: 'J\'ai acheté', compter: 'Je compte', autre: 'Autre', money: '', perte: 'Casse / maison', carnet: 'Carnet', personne: '', articles: 'Articles', article: 'Article', bilan: 'Bilan et dîme', dime: 'Verser la dîme', histo: 'Mes saisies', reglages: 'Réglages' };
  var TAB = { home: 'home', carnet: 'carnet', personne: 'carnet', articles: 'articles', article: 'articles', bilan: 'bilan', dime: 'bilan' };
  function go(name, p, replace) {
    cur = { name: name, p: p || {} }; form = {};
    var st = { name: name, p: cur.p };
    if (replace) history.replaceState(st, ''); else history.pushState(st, '');
    render(); window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', function (ev) {
    closeSheet();
    var st = ev.state || { name: 'home', p: {} };
    cur = { name: st.name, p: st.p || {} }; form = {}; render();
  });
  function back() { if (history.state && history.state.name !== 'home') history.back(); else go('home', {}, true); }
  document.getElementById('btnBack').onclick = back;
  document.getElementById('btnGear').onclick = function () { go('reglages'); };
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
    b.onclick = function () { go(b.dataset.tab); };
  });

  function render() {
    var t = TITLES[cur.name];
    if (cur.name === 'personne') t = P(cur.p.id).nom;
    if (cur.name === 'money') t = MONEY[cur.p.kind].titre;
    document.getElementById('title').textContent = t || 'Ma Boutique';
    document.getElementById('btnBack').style.visibility = cur.name === 'home' ? 'hidden' : 'visible';
    var tab = TAB[cur.name];
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    SCREENS[cur.name]();
    renderSync();
  }
  function html(s) { view.innerHTML = s; }
  function $(sel) { return view.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(view.querySelectorAll(sel)); }
  function on(sel, evn, fn) { $$(sel).forEach(function (el) { el.addEventListener(evn, function (ev) { fn(el, ev); }); }); }

  var toastT;
  function toast(msg) {
    var t = document.getElementById('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.add('hidden'); }, 2600);
  }
  var sheet = document.getElementById('sheet');
  function openSheet(inner, bind) {
    sheet.innerHTML = '<div>' + inner + '</div>'; sheet.classList.remove('hidden');
    sheet.onclick = function (ev) { if (ev.target === sheet) closeSheet(); };
    if (bind) bind(sheet);
  }
  function closeSheet() { sheet.classList.add('hidden'); sheet.innerHTML = ''; }
  function confirmBox(msg, okTxt, fn, danger) {
    openSheet('<h3>' + msg + '</h3><button class="btn ' + (danger ? 'danger' : '') + '" id="cOk">' + okTxt + '</button><button class="btn sec" id="cNo">Non, retour</button>', function (s) {
      s.querySelector('#cOk').onclick = function () { closeSheet(); fn(); };
      s.querySelector('#cNo').onclick = closeSheet;
    });
  }

  // ---------- Morceaux réutilisables ----------
  function dateChip() {
    var j = form.jour || today();
    return '<div class="row between" style="margin-bottom:8px"><span class="muted">Date</span>' +
      (form.jourEdit ? '<input type="date" class="inp" id="jourInp" style="max-width:210px;font-size:18px" value="' + j + '" max="' + today() + '">' :
        '<button class="datechip" id="jourBtn">📅 ' + (j === today() ? 'Aujourd\'hui' : dlong(j)) + ' ✎</button>') + '</div>';
  }
  function bindDate() {
    on('#jourBtn', 'click', function () { form.jourEdit = true; render(); });
    on('#jourInp', 'change', function (el) { if (el.value) form.jour = el.value > today() ? today() : el.value; });
  }
  function modeChips(key) {
    form[key] = form[key] || 'Espèces';
    return '<div class="chips" data-mode="' + key + '">' + MODES.map(function (m) {
      return '<button class="chip ' + (form[key] === m ? 'on' : '') + '" data-m="' + m + '">' + (m === 'Espèces' ? '💵 Espèces' : m === 'Wave' ? '🌊 Wave' : '🟠 Orange Money') + '</button>';
    }).join('') + '</div>';
  }
  function bindModes() {
    $$('[data-mode]').forEach(function (box) {
      Array.prototype.forEach.call(box.querySelectorAll('.chip'), function (c) {
        c.onclick = function () { form[box.dataset.mode] = c.dataset.m; Array.prototype.forEach.call(box.querySelectorAll('.chip'), function (x) { x.classList.toggle('on', x === c); }); };
      });
    });
  }
  function filterBind(inputSel, itemSel) {
    on(inputSel, 'input', function (el) {
      var q = norm(el.value);
      $$(itemSel).forEach(function (it) { it.style.display = !q || norm(it.dataset.q).indexOf(q) >= 0 ? '' : 'none'; });
    });
  }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function articlesTries(avecArchives) {
    return S.ordreArticles.map(A).filter(function (a) { return avecArchives || !a.archive; })
      .sort(function (a, b) { return (S.usage[b.id] || 0) - (S.usage[a.id] || 0) || a.nom.localeCompare(b.nom); });
  }
  function personnesTries() {
    return Object.keys(S.personnes).map(P).filter(function (p) { return !p.archive; })
      .sort(function (a, b) { return (S.usagePers[b.id] || 0) - (S.usagePers[a.id] || 0) || a.nom.localeCompare(b.nom); });
  }

  // Choix d'une personne
  function personPicker(key, filtre) {
    if (form[key]) {
      var p = P(form[key]);
      return '<div class="sel"><span style="font-size:26px">👤</span><span class="grow">' + esc(p.nom) +
        '<div class="small" style="font-weight:400">' + soldeTxt(p.solde) + '</div></span><button class="chip" id="chg_' + key + '">Changer</button></div>';
    }
    var list = personnesTries().filter(filtre || function () { return true; });
    return '<input class="inp search" id="ps_' + key + '" placeholder="🔎 Chercher un nom…" autocomplete="off">' +
      '<div class="tiles" style="max-height:38vh">' + list.map(function (p) {
        return '<button class="tile" data-pick="' + p.id + '" data-q="' + esc(p.nom) + '"><b>' + esc(p.nom) + '</b><span class="muted">' + soldeTxt(p.solde, true) + '</span></button>';
      }).join('') + '<button class="tile" id="newP_' + key + '" data-q="" style="border-style:dashed;color:var(--vert)"><b>＋ Nouvelle personne</b></button></div>';
  }
  function bindPersonPicker(key) {
    on('#chg_' + key, 'click', function () { form[key] = null; render(); });
    filterBind('#ps_' + key, '[data-pick]');
    on('[data-pick]', 'click', function (el) { form[key] = el.dataset.pick; render(); });
    on('#newP_' + key, 'click', function () {
      var q = ($('#ps_' + key) || {}).value || '';
      newPersonSheet(q, function (id) { form[key] = id; render(); });
    });
  }
  function newPersonSheet(nom, cb) {
    openSheet('<h3>Nouvelle personne</h3><label class="lab">Nom</label><input class="inp" id="npNom" value="' + esc(nom) + '" autocomplete="off">' +
      '<label class="lab">Téléphone (pas obligatoire)</label><input class="inp" id="npTel" inputmode="tel">' +
      '<button class="btn" id="npOk">Ajouter</button>', function (s) {
        var i = s.querySelector('#npNom'); i.focus();
        s.querySelector('#npOk').onclick = function () {
          var n = i.value.trim(); if (!n) return i.focus();
          var ex = Object.keys(S.personnes).map(P).filter(function (p) { return norm(p.nom) === norm(n); })[0];
          if (ex) { closeSheet(); toast('Cette personne existe déjà'); return cb(ex.id); }
          var id = 'p' + uid(); addEvent({ type: 'personne', p: { id: id, nom: n, tel: s.querySelector('#npTel').value.trim() } });
          closeSheet(); cb(id);
        };
      });
  }
  function soldeTxt(s, court) {
    if (Math.round(s) > 0) return '<span class="rouge">' + (court ? 'doit ' : 'Me doit ') + fmt(s) + '</span>';
    if (Math.round(s) < 0) return '<span class="orange">' + (court ? 'je dois ' : 'Je lui dois ') + fmt(-s) + '</span>';
    return '<span class="vert">À jour</span>';
  }

  // Choix des articles + panier
  function articlePicker(opts) {
    var arts = articlesTries();
    return '<input class="inp search" id="artSearch" placeholder="🔎 Chercher un article…" autocomplete="off">' +
      '<div class="tiles">' + arts.map(function (a) {
        return '<button class="tile" data-art="' + a.id + '" data-q="' + esc(a.nom) + '"><b>' + esc(a.nom) + '</b><span class="muted">' +
          fmt(a.prix) + ' · reste ' + Math.round(a.stock) + '</span></button>';
      }).join('') + (opts && opts.nouveau ? '<button class="tile" id="newArt" data-q="" style="border-style:dashed;color:var(--vert)"><b>＋ Nouvel article</b></button>' : '') + '</div>';
  }
  function cartHtml(lignes, kind) {
    if (!lignes.length) return '<div class="muted" style="text-align:center;padding:10px">Aucun article pour l\'instant. Touchez un article ci-dessus.</div>';
    var tot = 0;
    var s = '<div class="list cart">' + lignes.map(function (l, i) {
      var mt = kind === 'achat' ? l.montant : kind === 'perte' ? l.qte * A(l.art).cmup : l.qte * l.prix; tot += mt;
      return '<div class="li"><span class="grow"><b>' + l.qte + ' × ' + esc(A(l.art).nom) + '</b>' +
        (kind === 'credit' ? '<div class="muted">' + fmt(l.prix) + ' l\'unité</div>' : '') + '</span><span class="amt">' + (kind === 'perte' ? '' : fmt(mt)) + '</span>' +
        '<button class="x" data-del="' + i + '">✕</button></div>';
    }).join('') + '</div>';
    if (kind !== 'perte') s += '<div class="row between card"><b>TOTAL</b><span class="mid">' + fmt(tot) + '</span></div>';
    return s;
  }
  function bindCart(lignes, kind, sheetFn) {
    filterBind('#artSearch', '[data-art]');
    on('[data-art]', 'click', function (el) { sheetFn(el.dataset.art); });
    on('[data-del]', 'click', function (el) { lignes.splice(+el.dataset.del, 1); render(); });
  }
  function qtySheet(artId, opts, cb) {
    var a = A(artId);
    var dernier = a.dernierPA || a.cmup || 0;
    var h = '<h3>' + esc(a.nom) + '</h3><div class="muted">Il en reste ' + Math.round(a.stock) + ' · prix habituel ' + fmt(a.prix) + '</div>' +
      '<label class="lab">Combien ? (' + esc(a.unite || 'unités') + ')</label>' +
      '<div class="stepper"><button id="qm">−</button><input id="qv" inputmode="numeric" value="1"><button id="qp">+</button></div>' +
      (opts.achat ? '<div class="quick">' + [6, 10, 12, 24, 30].map(function (n) { return '<button data-q="' + n + '">' + n + '</button>'; }).join('') + '</div>' : '');
    if (opts.prix) h += '<label class="lab">Prix de l\'unité</label><input class="inp" id="pv" inputmode="numeric" value="' + Math.round(a.prix) + '">';
    if (opts.achat) h += '<label class="lab">Montant total payé pour tout ça</label><input class="inp" id="mv" inputmode="numeric" placeholder="ex : 2 400">' +
      '<div class="muted" id="mHint">Dernier prix : ' + fmt(dernier) + ' l\'unité</div>';
    h += '<button class="btn" id="qOk">Ajouter</button><button class="btn sec" id="qNo">Annuler</button>';
    openSheet(h, function (s) {
      var qv = s.querySelector('#qv'), mv = s.querySelector('#mv');
      function q() { return Math.max(num(qv.value) || 0, 0); }
      function hint() { if (mv && !mv.dataset.touched) mv.placeholder = 'environ ' + fmt(q() * dernier); }
      s.querySelector('#qm').onclick = function () { qv.value = Math.max(q() - 1, 0); hint(); };
      s.querySelector('#qp').onclick = function () { qv.value = q() + 1; hint(); };
      Array.prototype.forEach.call(s.querySelectorAll('[data-q]'), function (b) { b.onclick = function () { qv.value = b.dataset.q; hint(); }; });
      qv.oninput = hint; if (mv) mv.oninput = function () { mv.dataset.touched = 1; };
      qv.onfocus = function () { qv.select(); };
      hint();
      s.querySelector('#qNo').onclick = closeSheet;
      s.querySelector('#qOk').onclick = function () {
        var n = q(); if (!n) { qv.focus(); return; }
        var l = { art: artId, qte: n };
        if (opts.prix) { var p = num(s.querySelector('#pv').value); if (p == null) return s.querySelector('#pv').focus(); l.prix = p; }
        if (opts.achat) { var m = num(mv.value); if (m == null) { if (!dernier) return mv.focus(); m = Math.round(n * dernier); } l.montant = m; }
        closeSheet(); cb(l);
      };
    });
  }
  function newArticleSheet(cb) {
    var f = { unite: 'Pièce', cat: 'Alimentation' };
    function chips(list, key) { return '<div class="chips" data-k="' + key + '">' + list.map(function (u) { return '<button class="chip ' + (f[key] === u ? 'on' : '') + '" data-v="' + esc(u) + '">' + esc(u) + '</button>'; }).join('') + '</div>'; }
    openSheet('<h3>Nouvel article</h3><label class="lab">Nom de l\'article</label><input class="inp" id="naNom" placeholder="ex : Lait Bonnet Rouge 15g" autocomplete="off">' +
      '<label class="lab">Se vend à</label>' + chips(UNITES, 'unite') +
      '<label class="lab">Prix de vente (1 unité)</label><input class="inp" id="naPrix" inputmode="numeric">' +
      '<label class="lab">Type</label>' + chips(CATS, 'cat') +
      '<button class="btn" id="naOk">Créer l\'article</button><button class="btn sec" id="naNo">Annuler</button>', function (s) {
        Array.prototype.forEach.call(s.querySelectorAll('[data-k]'), function (box) {
          Array.prototype.forEach.call(box.querySelectorAll('.chip'), function (c) {
            c.onclick = function () { f[box.dataset.k] = c.dataset.v; Array.prototype.forEach.call(box.querySelectorAll('.chip'), function (x) { x.classList.toggle('on', x === c); }); };
          });
        });
        s.querySelector('#naNo').onclick = closeSheet;
        s.querySelector('#naOk').onclick = function () {
          var n = s.querySelector('#naNom').value.trim(), p = num(s.querySelector('#naPrix').value);
          if (!n) return s.querySelector('#naNom').focus();
          if (p == null) return s.querySelector('#naPrix').focus();
          var id = 'a' + uid();
          addEvent({ type: 'article', art: { id: id, nom: n, unite: f.unite, cat: f.cat, prix: p } });
          closeSheet(); cb(id);
        };
        s.querySelector('#naNom').focus();
      });
  }
  function saved(msg, dest, p) { toast('✅ ' + (msg || 'Enregistré')); go(dest || 'home', p || {}, true); }

  // ---------- Écrans ----------
  var SCREENS = {};

  SCREENS.home = function () {
    var dc = S.caisse.dernier;
    var dejaCompte = dc && dc.jour === today();
    var recents = events.filter(function (e) { return ['annule', 'init', 'reglages'].indexOf(e.type) < 0 && !S.annules[e.id]; }).slice(-4).reverse();
    var vierge = !S.ordreArticles.length;
    if (vierge) {
      html('<div class="card" style="text-align:center"><div style="font-size:56px">🏪</div><div class="mid">Bienvenue dans Ma Boutique</div>' +
        '<p class="muted">Pour commencer, chargez le fichier <b>donnees_depart_Mathias.json</b> (articles, prix, carnet des crédits).</p>' +
        '<button class="btn" id="hStart">Charger les données de départ</button></div>');
      on('#hStart', 'click', function () { go('reglages'); });
      return;
    }
    html(
      (vierge ? '<div class="info" style="font-size:17px"><b>Bienvenue !</b> Pour commencer, chargez les données de départ : ⚙︎ en haut à droite → « Charger une copie » → choisir le fichier <b>donnees_depart_Mathias.json</b>.<br><button class="btn" id="hStart">Charger les données de départ</button></div>' : '') +
      '<div class="card dime"><h2>🙏 Dîme à verser</h2><div class="row between"><span class="big">' + fmt(Math.max(S.dimeDue, 0)) + '</span>' +
      '<button class="btn inline" style="background:#fff;color:var(--vert)" id="hDime">J\'ai versé</button></div>' +
      (S.dimeDue < 0 ? '<div class="small">Vous avez versé ' + fmt(-S.dimeDue) + ' d\'avance.</div>' : '') + '</div>' +
      '<div class="grid2">' +
      '<button class="card action" id="hCarnet" style="min-height:0;align-items:flex-start"><span class="muted">On me doit</span><span class="mid rouge">' + fmt(S.aEncaisser) + '</span></button>' +
      '<button class="card action" id="hCaisse" style="min-height:0;align-items:flex-start"><span class="muted">Argent attendu</span><span class="mid">' + fmt(S.caisse.attendu) + '</span></button></div>' +
      (!dejaCompte ? '<div class="note">⏰ Dernier comptage de l\'argent : ' + (dc ? dlong(dc.jour) : '—') + '. Pensez à compter ce soir.</div>' : '') +
      (R.depart ? '<div class="info">Le prochain comptage du stock sera un <b>comptage de départ</b> (aucune vente calculée).</div>' : '') +
      '<div class="grid2" style="margin-top:4px">' +
      '<button class="action main" data-go="compter"><span class="ico">🔢</span>Je compte<br><span class="small" style="font-weight:400">le stock et l\'argent</span></button>' +
      '<button class="action" data-go="credit"><span class="ico">📝</span>Vente à crédit</button>' +
      '<button class="action" data-go="paiement"><span class="ico">💵</span>On m\'a payé</button>' +
      '<button class="action" data-go="achat"><span class="ico">🛒</span>J\'ai acheté</button>' +
      '<button class="action" data-go="autre"><span class="ico">➕</span>Autre<br><span class="small" style="font-weight:400">dépense, prêt, casse…</span></button></div>' +
      '<div class="row between" style="margin:18px 4px 6px"><b>Dernières saisies</b><button class="chip" data-go="histo">Tout voir</button></div>' +
      '<div class="list">' + (recents.length ? recents.map(evRow).join('') : '<div class="li muted">Rien pour l\'instant</div>') + '</div>'
    );
    on('[data-go]', 'click', function (el) { go(el.dataset.go); });
    on('#hDime', 'click', function () { go('dime'); });
    on('#hStart', 'click', function () { go('reglages'); });
    on('#hCarnet', 'click', function () { go('carnet'); });
    on('#hCaisse', 'click', function () { go('compter', { argent: 1 }); });
  };
  function annTxt(ann) { return ann ? '<div class="small" style="color:var(--rouge);text-decoration:none;opacity:1">↩︎ Annulé' + (ann.par ? ' par ' + esc(ann.par) : '') + ' ' + (ann.jour === today() ? 'aujourd\'hui' : 'le ' + dshort(ann.jour)) + '</div>' : ''; }
  function evRow(e) {
    var d = describe(e), ann = S.annules[e.id];
    return '<div class="li ' + (ann ? 'struck' : '') + '"><span class="ico">' + d[0] + '</span><span class="grow">' + esc(d[1]) +
      '<div class="muted">' + dshort(e.jour) + '</div>' + annTxt(ann) + '</span><span class="amt">' + d[2] + '</span></div>';
  }

  // Vente à crédit
  SCREENS.credit = function () {
    form.lignes = form.lignes || [];
    if (!form.p && cur.p.personne) form.p = cur.p.personne;
    var ok = form.p && form.lignes.length;
    html(dateChip() + '<label class="lab" style="margin-top:0">1. Qui prend à crédit ?</label>' + personPicker('p') +
      (form.p ? '<label class="lab">2. Qu\'est-ce qu\'il prend ?</label>' + articlePicker() + '<div style="margin-top:10px">' + cartHtml(form.lignes, 'credit') + '</div>' : '') +
      '<div class="sticky"><button class="btn" id="ok" ' + (ok ? '' : 'disabled') + '>Enregistrer le crédit</button></div>');
    bindDate(); bindPersonPicker('p');
    bindCart(form.lignes, 'credit', function (id) { qtySheet(id, { prix: true }, function (l) { form.lignes.push(l); render(); }); });
    on('#ok', 'click', function () {
      var tot = form.lignes.reduce(function (s, l) { return s + l.qte * l.prix; }, 0);
      addEvent({ type: 'credit', personne: form.p, lignes: form.lignes }, form.jour);
      saved(P(form.p).nom + ' : ' + fmt(tot) + ' à crédit');
    });
  };

  // Paiement d'un client
  SCREENS.paiement = function () {
    if (!form.p && cur.p.personne) form.p = cur.p.personne;
    var p = form.p ? P(form.p) : null;
    html(dateChip() + '<label class="lab" style="margin-top:0">Qui a payé ?</label>' + personPicker('p', function (x) { return x.solde > 0; }) +
      (p ? '<label class="lab">Combien ?</label><div class="row"><input class="inp grow" id="mt" inputmode="numeric" placeholder="Montant">' +
        (p.solde > 0 ? '<button class="chip" id="tout">Tout : ' + fmt(p.solde) + '</button>' : '') + '</div>' +
        '<label class="lab">Payé comment ?</label>' + modeChips('mode') +
        '<div class="sticky"><button class="btn" id="ok">Enregistrer le paiement</button></div>' : ''));
    bindDate(); bindPersonPicker('p'); bindModes();
    on('#tout', 'click', function () { $('#mt').value = Math.round(p.solde); });
    on('#ok', 'click', function () {
      var m = num($('#mt').value); if (!m || m <= 0) return $('#mt').focus();
      addEvent({ type: 'paiement', personne: form.p, montant: m, mode: form.mode }, form.jour);
      var reste = P(form.p).solde;
      saved(p.nom + ' a payé ' + fmt(m) + (reste > 0 ? ' — reste ' + fmt(reste) : ' — à jour'));
    });
  };

  // Achat
  SCREENS.achat = function () {
    form.lignes = form.lignes || []; form.paye = form.paye || 'tout';
    var fs = Object.keys(S.fournisseurs).map(F);
    var tot = form.lignes.reduce(function (s, l) { return s + l.montant; }, 0);
    html(dateChip() + '<label class="lab" style="margin-top:0">Où ? (pas obligatoire)</label><div class="chips">' +
      fs.map(function (f) { return '<button class="chip ' + (form.f === f.id ? 'on' : '') + '" data-f="' + f.id + '">' + esc(f.nom) + '</button>'; }).join('') +
      '<button class="chip" id="newF">＋</button></div>' +
      '<label class="lab">Qu\'avez-vous acheté ?</label>' + articlePicker({ nouveau: true }) +
      '<div style="margin-top:10px">' + cartHtml(form.lignes, 'achat') + '</div>' +
      (form.lignes.length ? '<label class="lab">Payé ?</label><div class="chips" id="payeBox">' +
        [['tout', 'Tout payé'], ['partie', 'Une partie'], ['rien', 'Rien (à crédit)']].map(function (o) { return '<button class="chip ' + (form.paye === o[0] ? 'on' : '') + '" data-p="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>' +
        (form.paye === 'partie' ? '<input class="inp" id="payeMt" inputmode="numeric" placeholder="Montant payé" style="margin-top:8px" value="' + (form.payeMt || '') + '">' : '') +
        (form.paye !== 'rien' ? '<label class="lab">Payé comment ?</label>' + modeChips('mode') : '') +
        (form.paye !== 'tout' && !form.f ? '<div class="note">Choisissez le fournisseur en haut pour suivre ce que vous lui devez.</div>' : '') : '') +
      '<div class="sticky"><button class="btn" id="ok" ' + (form.lignes.length ? '' : 'disabled') + '>Enregistrer l\'achat</button></div>');
    bindDate(); bindModes();
    on('[data-f]', 'click', function (el) { form.f = form.f === el.dataset.f ? null : el.dataset.f; render(); });
    on('#newF', 'click', function () {
      openSheet('<h3>Nouveau fournisseur</h3><input class="inp" id="nf" autocomplete="off"><button class="btn" id="nfOk">Ajouter</button>', function (s) {
        s.querySelector('#nf').focus();
        s.querySelector('#nfOk').onclick = function () { var n = s.querySelector('#nf').value.trim(); if (!n) return; var id = 'f' + uid(); addEvent({ type: 'fournisseur', f: { id: id, nom: n } }); form.f = id; closeSheet(); render(); };
      });
    });
    on('[data-p]', 'click', function (el) { form.paye = el.dataset.p; render(); });
    on('#payeMt', 'input', function (el) { form.payeMt = el.value; });
    bindCart(form.lignes, 'achat', function (id) { qtySheet(id, { achat: true }, function (l) { form.lignes.push(l); render(); }); });
    on('#newArt', 'click', function () { newArticleSheet(function (id) { render(); qtySheet(id, { achat: true }, function (l) { form.lignes.push(l); render(); }); }); });
    on('#ok', 'click', function () {
      var paye = form.paye === 'tout' ? tot : form.paye === 'rien' ? 0 : num(form.payeMt);
      if (paye == null) return $('#payeMt').focus();
      addEvent({ type: 'achat', fournisseur: form.f || null, lignes: form.lignes, paye: Math.min(paye, tot), mode: form.paye === 'rien' ? null : form.mode }, form.jour);
      saved('Achat de ' + fmt(tot) + ' enregistré');
    });
  };

  // Je compte
  SCREENS.compter = function () {
    if (form.step == null) { form.step = cur.p.argent ? 2 : 1; form.comptes = {}; form.tous = false; }
    var steps = '<div class="steps"><div class="' + (form.step >= 1 ? 'on' : '') + '"></div><div class="' + (form.step >= 2 ? 'on' : '') + '"></div><div class="' + (form.step >= 3 ? 'on' : '') + '"></div></div>';
    if (form.step === 1) {
      var arts = S.ordreArticles.map(A).filter(function (a) { return !a.archive && (form.tous || a.stock > 0 || form.comptes[a.id] != null); })
        .sort(function (a, b) { return (S.usage[b.id] || 0) - (S.usage[a.id] || 0) || a.nom.localeCompare(b.nom); });
      var n = Object.keys(form.comptes).length;
      html(steps + '<div class="card"><b>1. Le stock</b><div class="muted">Comptez ce qui reste dans la boutique et écrivez le nombre. Les articles que vous ne comptez pas aujourd\'hui, laissez-les vides.</div></div>' +
        (R.depart ? '<div class="info"><b>Comptage de départ</b> : on note juste le stock, sans calculer de ventes.</div>' : '') +
        '<input class="inp search" id="cs" placeholder="🔎 Chercher…" autocomplete="off">' +
        '<div class="chips" style="margin-bottom:8px"><button class="chip ' + (!form.tous ? 'on' : '') + '" id="fStock">Ceux qui ont du stock</button><button class="chip ' + (form.tous ? 'on' : '') + '" id="fTous">Tous</button></div>' +
        '<div class="list">' + arts.map(function (a) {
          var v = form.comptes[a.id];
          return '<div class="countrow" data-q="' + esc(a.nom) + '"><span class="grow"><b>' + esc(a.nom) + '</b><span class="muted">Il devrait y avoir <b style="display:inline">' + Math.round(a.stock) + '</b></span></span>' +
            '<button class="same" data-same="' + a.id + '">= ' + Math.round(a.stock) + '</button>' +
            '<input inputmode="numeric" data-c="' + a.id + '" class="' + (v != null ? 'filled' : '') + '" value="' + (v != null ? v : '') + '" placeholder="?"></div>';
        }).join('') + '</div>' +
        '<div class="sticky"><button class="btn" id="next">' + (n ? 'Suivant : l\'argent (' + n + ' comptés) →' : 'Passer : je compte seulement l\'argent →') + '</button></div>');
      filterBind('#cs', '.countrow');
      on('#fStock', 'click', function () { form.tous = false; render(); });
      on('#fTous', 'click', function () { form.tous = true; render(); });
      on('[data-c]', 'input', function (el) {
        var v = num(el.value);
        if (v == null || v < 0) delete form.comptes[el.dataset.c]; else form.comptes[el.dataset.c] = v;
        el.classList.toggle('filled', v != null);
        var n2 = Object.keys(form.comptes).length;
        $('#next').textContent = n2 ? 'Suivant : l\'argent (' + n2 + ' comptés) →' : 'Passer : je compte seulement l\'argent →';
      });
      on('[data-same]', 'click', function (el) {
        var inp = $('[data-c="' + el.dataset.same + '"]'); inp.value = Math.round(A(el.dataset.same).stock);
        inp.dispatchEvent(new Event('input'));
      });
      on('#next', 'click', function () { form.step = 2; render(); window.scrollTo(0, 0); });
      return;
    }
    if (form.step === 2) {
      html(steps + '<div class="card"><b>2. L\'argent</b><div class="muted">Comptez les billets et les pièces, puis regardez les soldes Wave et Orange Money.</div></div>' +
        '<label class="lab">💵 Espèces (billets + pièces)</label><input class="inp" id="esp" inputmode="numeric" value="' + (form.esp != null ? form.esp : '') + '">' +
        '<label class="lab">🌊 Solde Wave</label><input class="inp" id="wave" inputmode="numeric" value="' + (form.wave != null ? form.wave : '') + '">' +
        '<label class="lab">🟠 Solde Orange Money</label><input class="inp" id="om" inputmode="numeric" value="' + (form.om != null ? form.om : '') + '">' +
        '<div class="sticky"><button class="btn" id="val">Valider le comptage</button>' +
        (Object.keys(form.comptes).length ? '<button class="btn sec" id="skip">Je ne compte pas l\'argent maintenant</button>' : '') + '</div>');
      on('#val', 'click', function () {
        var esp = num($('#esp').value), wave = num($('#wave').value), om = num($('#om').value);
        if (esp == null) return $('#esp').focus();
        if (wave == null) return $('#wave').focus();
        if (om == null) return $('#om').focus();
        finish({ esp: esp, wave: wave, om: om });
      });
      on('#skip', 'click', function () { finish(null); });
      return;
    }
    // Étape 3 : résultat
    var res = form.res;
    var v = res.ventes, totV = v.reduce(function (s, x) { return s + x.montant; }, 0), totM = v.reduce(function (s, x) { return s + x.marge; }, 0);
    var h = steps + '<div class="card"><h2>Ventes au comptant trouvées</h2>';
    if (res.depart) h += '<div class="ok">Comptage de départ enregistré. Le stock est à jour.</div>';
    else if (!res.nbComptes) h += '<div class="muted">Pas de stock compté cette fois.</div>';
    else if (!v.length) h += '<div class="muted">Aucune vente au comptant sur les articles comptés.</div>';
    else h += '<table class="t"><tr><th>Article</th><th class="n">Qté</th><th class="n">Montant</th></tr>' +
      v.map(function (x) { return '<tr><td>' + esc(A(x.art).nom) + '</td><td class="n">' + x.qte + '</td><td class="n">' + fmt(x.montant) + '</td></tr>'; }).join('') +
      '<tr><td><b>Total</b></td><td></td><td class="n"><b>' + fmt(totV) + '</b></td></tr></table>' +
      '<div class="kv"><span>Bénéfice</span><b class="vert">' + fmt(totM) + '</b></div><div class="kv"><span>Dîme sur ces ventes</span><b>' + fmt(Math.max(totM, 0) * S.taux) + '</b></div>';
    if (res.plus.length) h += '<div class="note">Plus de stock que prévu pour : ' + res.plus.map(function (x) { return esc(A(x.art).nom) + ' (+' + x.qte + ')'; }).join(', ') + '. Un achat ou un retour oublié ?</div>';
    h += '</div>';
    if (res.caisse) {
      var c = res.caisse, ec = Math.round(c.ecart);
      h += '<div class="card"><h2>L\'argent</h2><div class="kv"><span>Attendu</span><b>' + fmt(c.attendu) + '</b></div><div class="kv"><span>Compté</span><b>' + fmt(c.total) + '</b></div>';
      if (ec === 0) h += '<div class="ok" style="font-size:20px">✅ Tout correspond !</div>';
      else if (ec < 0) h += '<div class="bad" style="font-size:20px">⚠️ Il manque ' + fmt(-ec) + '</div><div class="muted">Un achat, une dépense, un crédit ou de l\'argent pris pour la maison n\'est peut-être pas noté.</div>';
      else h += '<div class="note" style="font-size:20px">Il y a ' + fmt(ec) + ' de plus que prévu</div><div class="muted">Souvent : des articles vendus mais pas encore comptés, ou un paiement reçu pas noté.</div>';
      if (ec !== 0) h += '<label class="lab">Explication (pas obligatoire)</label><input class="inp" id="expl" style="font-size:18px" placeholder="ex : monnaie mal rendue">';
      h += '</div>';
    }
    h += '<button class="btn" id="fin">Terminé</button>';
    html(h);
    on('#fin', 'click', function () {
      var ex = $('#expl');
      if (ex && ex.value.trim() && res.caisseId) {
        var ev = events.filter(function (e) { return e.id === res.caisseId; })[0];
        if (ev) { ev.note = ex.value.trim(); save('bm_events', events); delete synced[ev.id]; save('bm_synced', synced); S = E.compute(events); syncSoon(); }
      }
      go('home', {}, true);
    });

    function finish(argent) {
      var nb = Object.keys(form.comptes).length, res = { ventes: [], plus: [], nbComptes: nb, depart: R.depart && nb > 0 };
      if (nb) {
        var ev = addEvent({ type: 'comptageStock', comptes: form.comptes, depart: !!R.depart });
        res.ventes = S.ventes.filter(function (x) { return x.ts === ev.ts; });
        res.plus = S.ecartsStock.filter(function (x) { return x.ts === ev.ts; });
        if (R.depart) { R.depart = false; save('bm_reglages', R); }
      }
      if (argent) {
        var ec = addEvent({ type: 'comptageCaisse', esp: argent.esp, wave: argent.wave, om: argent.om });
        res.caisse = S.caisses[S.caisses.length - 1]; res.caisseId = ec.id;
      }
      form.res = res; form.step = 3; render(); window.scrollTo(0, 0);
    }
  };

  // Autre
  var MONEY = {
    depense: { titre: 'Dépense', ico: '🚚', desc: 'Transport, sachets, électricité, patente…', cats: true },
    fournisseur: { titre: 'Payer un fournisseur', ico: '🏭', desc: 'Rembourser un achat fait à crédit', fourn: true },
    pret: { titre: 'J\'ai prêté de l\'argent', ico: '🤝', desc: 'Quelqu\'un doit me le rendre', pers: true },
    garde: { titre: 'On m\'a remis de l\'argent', ico: '📥', desc: 'Emprunt, monnaie à rendre, argent de Delphine…', pers: true },
    rendu: { titre: 'J\'ai rendu de l\'argent', ico: '📤', desc: 'Je rembourse ou je remets l\'argent gardé', pers: true },
    prelevement: { titre: 'J\'ai pris de l\'argent pour moi', ico: '👛', desc: 'Argent de poche, maison, famille' },
    epargne: { titre: 'Mettre de côté (épargne)', ico: '🏦', desc: 'Argent mis de côté hors de la boutique' },
    epargneRet: { titre: 'Reprendre de l\'épargne', ico: '🏧', desc: 'Remettre de l\'épargne dans la boutique' },
    apport: { titre: 'J\'ai ajouté mon argent', ico: '➕', desc: 'Argent personnel mis dans la boutique' }
  };
  SCREENS.autre = function () {
    var items = [['depense'], ['perte', '💔', 'Casse, périmé, pris pour la maison', 'Des articles sortis sans être vendus'], ['fournisseur'], ['pret'], ['garde'], ['rendu'], ['prelevement'], ['epargne'], ['epargneRet'], ['apport']];
    html('<div class="list">' + items.map(function (it) {
      var m = MONEY[it[0]] || { titre: it[2], ico: it[1], desc: it[3] };
      var d = m.desc;
      return '<button class="li" data-k="' + it[0] + '"><span class="ico">' + m.ico + '</span><span class="grow"><b>' + m.titre + '</b><div class="muted">' + d + '</div></span><span>›</span></button>';
    }).join('') + '</div>');
    on('[data-k]', 'click', function (el) { if (el.dataset.k === 'perte') go('perte'); else go('money', { kind: el.dataset.k }); });
  };
  SCREENS.money = function () {
    var k = cur.p.kind, m = MONEY[k];
    if (!form.p && cur.p.personne) form.p = cur.p.personne;
    var h = dateChip();
    if (m.pers) h += '<label class="lab" style="margin-top:0">Qui ?</label>' + personPicker('p');
    if (m.fourn) {
      var fs = Object.keys(S.fournisseurs).map(F);
      h += '<label class="lab" style="margin-top:0">Quel fournisseur ?</label><div class="chips">' + fs.map(function (f) {
        return '<button class="chip ' + (form.f === f.id ? 'on' : '') + '" data-f="' + f.id + '">' + esc(f.nom) + (f.dette > 0 ? ' · ' + fmt(f.dette) : '') + '</button>';
      }).join('') + '</div>';
    }
    if (m.cats) h += '<label class="lab" style="margin-top:0">C\'est pour quoi ?</label><div class="chips">' + DEPENSES.map(function (c) {
      return '<button class="chip ' + (form.cat === c ? 'on' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('') + '</div>';
    var ready = (!m.pers || form.p) && (!m.fourn || form.f) && (!m.cats || form.cat);
    if (ready) {
      h += '<label class="lab">Montant</label><input class="inp" id="mt" inputmode="numeric" value="' + (form.mt || '') + '">' +
        '<label class="lab">' + (k === 'garde' || k === 'apport' || k === 'epargneRet' ? 'Reçu' : 'Payé') + ' comment ?</label>' + modeChips('mode') +
        '<label class="lab">Note (pas obligatoire)</label><input class="inp" id="note" style="font-size:18px" value="' + esc(form.note || '') + '">' +
        '<div class="sticky"><button class="btn" id="ok">Enregistrer</button></div>';
    }
    html(h);
    bindDate(); bindModes(); if (m.pers) bindPersonPicker('p');
    on('#mt', 'input', function (el) { form.mt = el.value; });
    on('#note', 'input', function (el) { form.note = el.value; });
    on('[data-f]', 'click', function (el) { form.f = el.dataset.f; render(); });
    on('[data-cat]', 'click', function (el) { form.cat = el.dataset.cat; render(); });
    on('#ok', 'click', function () {
      var mt = num($('#mt').value); if (!mt || mt <= 0) return $('#mt').focus();
      var note = $('#note').value.trim(), ev = { montant: mt, mode: form.mode, note: note || undefined };
      if (k === 'depense') { ev.type = 'depense'; ev.cat = form.cat; }
      else if (k === 'fournisseur') { ev.type = 'paiementFournisseur'; ev.fournisseur = form.f; }
      else if (k === 'epargne') { ev.type = 'epargne'; ev.sens = 1; }
      else if (k === 'epargneRet') { ev.type = 'epargne'; ev.sens = -1; }
      else { ev.type = k; if (m.pers) ev.personne = form.p; }
      addEvent(ev, form.jour);
      saved(k === 'epargne' || k === 'epargneRet' ? m.titre + ' : enregistré' : m.titre + ' : ' + fmt(mt), m.pers && cur.p.personne ? 'personne' : 'home', m.pers && cur.p.personne ? { id: form.p } : null);
    });
  };
  SCREENS.perte = function () {
    form.lignes = form.lignes || []; form.raison = form.raison || 'Cassé / périmé';
    html(dateChip() + '<label class="lab" style="margin-top:0">Pourquoi ?</label><div class="chips">' +
      ['Cassé / périmé', 'Pris pour la maison', 'Offert', 'Volé / perdu'].map(function (r) { return '<button class="chip ' + (form.raison === r ? 'on' : '') + '" data-r="' + r + '">' + r + '</button>'; }).join('') + '</div>' +
      '<label class="lab">Quels articles ?</label>' + articlePicker() + '<div style="margin-top:10px">' + cartHtml(form.lignes, 'perte') + '</div>' +
      '<div class="sticky"><button class="btn" id="ok" ' + (form.lignes.length ? '' : 'disabled') + '>Enregistrer</button></div>');
    bindDate();
    on('[data-r]', 'click', function (el) { form.raison = el.dataset.r; render(); });
    bindCart(form.lignes, 'perte', function (id) { qtySheet(id, {}, function (l) { form.lignes.push(l); render(); }); });
    on('#ok', 'click', function () { addEvent({ type: 'perte', raison: form.raison, lignes: form.lignes }, form.jour); saved(); });
  };

  // Carnet
  SCREENS.carnet = function () {
    var ps = Object.keys(S.personnes).map(P).filter(function (p) { return !p.archive; });
    var doivent = ps.filter(function (p) { return Math.round(p.solde) > 0; }).sort(function (a, b) { return b.solde - a.solde; });
    var dois = ps.filter(function (p) { return Math.round(p.solde) < 0; }).sort(function (a, b) { return a.solde - b.solde; });
    var ajour = ps.filter(function (p) { return Math.round(p.solde) === 0; }).sort(function (a, b) { return a.nom.localeCompare(b.nom); });
    var fs = Object.keys(S.fournisseurs).map(F).filter(function (f) { return Math.round(f.dette) > 0; });
    function rows(list) { return list.map(function (p) { return '<button class="li" data-p="' + p.id + '" data-q="' + esc(p.nom) + '"><span class="grow"><b>' + esc(p.nom) + '</b></span>' + '<span class="amt">' + soldeTxt(p.solde, true) + '</span><span>›</span></button>'; }).join(''); }
    html('<div class="grid2"><div class="card"><h2>On me doit</h2><div class="mid rouge">' + fmt(S.aEncaisser) + '</div></div><div class="card"><h2>Je dois</h2><div class="mid orange">' + fmt(S.aRendre + S.detteFourn) + '</div></div></div>' +
      '<input class="inp search" id="cs" placeholder="🔎 Chercher un nom…" autocomplete="off">' +
      (doivent.length ? '<div class="daysep">Ils me doivent (' + doivent.length + ')</div><div class="list">' + rows(doivent) + '</div>' : '') +
      (dois.length ? '<div class="daysep">Je leur dois (' + dois.length + ')</div><div class="list">' + rows(dois) + '</div>' : '') +
      (fs.length ? '<div class="daysep">Fournisseurs à payer</div><div class="list">' + fs.map(function (f) { return '<button class="li" data-fp="' + f.id + '"><span class="grow"><b>' + esc(f.nom) + '</b></span><span class="amt orange">' + fmt(f.dette) + '</span><span>›</span></button>'; }).join('') + '</div>' : '') +
      '<div class="daysep">À jour (' + ajour.length + ')</div><div class="list">' + rows(ajour) + '</div>' +
      '<button class="btn sec" id="np">＋ Nouvelle personne</button>');
    filterBind('#cs', '[data-q]');
    on('[data-p]', 'click', function (el) { go('personne', { id: el.dataset.p }); });
    on('[data-fp]', 'click', function () { go('money', { kind: 'fournisseur' }); });
    on('#np', 'click', function () { newPersonSheet('', function (id) { go('personne', { id: id }); }); });
  };
  SCREENS.personne = function () {
    var p = P(cur.p.id), s = Math.round(p.solde);
    var histo = p.histo.slice().reverse();
    function openList(list) {
      return '<div class="list">' + list.slice().reverse().map(function (x) {
        var det = x.lignes ? x.lignes.map(function (l) { return esc(l.qte + ' × ' + (l.nom || A(l.art).nom)) + ' <span class="muted">à ' + fmt(l.prix) + '</span>'; }).join('<br>') : '';
        var partiel = x.reste < x.montant - 0.5;
        return '<div class="li" style="align-items:flex-start"><span class="grow"><b style="font-size:15px">' + esc(x.txt) + '</b>' +
          (det ? '<div style="font-size:15px;margin-top:2px">' + det + '</div>' : '') +
          '<div class="muted">' + dshort(x.jour) + (partiel ? ' · déjà payé ' + fmt(x.montant - x.reste) + ' sur ' + fmt(x.montant) : '') + '</div></span>' +
          '<span class="amt">' + fmt(x.reste) + '</span></div>';
      }).join('') + '</div>';
    }
    var tD = p.dettes.reduce(function (s2, x) { return s2 + x.reste; }, 0), tA = p.avoirs.reduce(function (s2, x) { return s2 + x.reste; }, 0);
    var detail = '';
    if (p.dettes.length) detail += '<div class="daysep">🔴 Ce qu\'il me doit encore — ' + fmt(tD) + '</div>' + openList(p.dettes);
    if (p.avoirs.length) detail += '<div class="daysep">🟠 Ce que je lui dois encore — ' + fmt(tA) + '</div>' + openList(p.avoirs);
    if (p.dettes.length && p.avoirs.length) detail += '<div class="info">Différence : ' + (s > 0 ? 'il me doit ' + fmt(s) : s < 0 ? 'je lui dois ' + fmt(-s) : 'on est quittes') + ' (' + fmt(tD) + ' − ' + fmt(tA) + ')</div>';
    html('<div class="card" style="text-align:center"><div class="muted">' + (s > 0 ? 'Me doit' : s < 0 ? 'Je lui dois' : 'Solde') + '</div><div class="big ' + (s > 0 ? 'rouge' : s < 0 ? 'orange' : 'vert') + '">' + (s === 0 ? 'À jour ✅' : fmt(Math.abs(s))) + '</div></div>' +
      '<div class="grid2">' +
      (s > 0 ? '<button class="action" data-a="paiement"><span class="ico">💵</span>Il a payé</button>' : '<button class="action" data-a="rendu"><span class="ico">📤</span>Je lui ai rendu</button>') +
      '<button class="action" data-a="credit"><span class="ico">📝</span>Vente à crédit</button></div>' +
      detail +
      '<div class="list" style="margin-top:12px">' +
      (s > 0 ? '<button class="li" id="rappel"><span class="ico">📲</span><span class="grow">Envoyer un rappel WhatsApp</span></button>' : '') +
      '<button class="li" data-a="pret"><span class="ico">🤝</span><span class="grow">Je lui ai prêté de l\'argent</span></button>' +
      '<button class="li" data-a="garde"><span class="ico">📥</span><span class="grow">Il m\'a remis de l\'argent (à rendre)</span></button>' +
      (s > 0 ? '<button class="li" data-a="rendu"><span class="ico">📤</span><span class="grow">Je lui ai rendu de l\'argent</span></button>' : '<button class="li" data-a="paiement"><span class="ico">💵</span><span class="grow">Il m\'a payé</span></button>') +
      '<button class="li" id="edit"><span class="ico">✏️</span><span class="grow">Modifier le nom / corriger le solde</span></button></div>' +
      '<div class="daysep">Tout l\'historique</div><div class="list">' + (histo.length ? histo.map(function (h) {
        return '<div class="li"><span class="grow">' + esc(h.txt) + '<div class="muted">' + dshort(h.jour) + '</div></span><span class="amt ' + (h.m > 0 ? 'rouge' : 'vert') + '">' + (h.m > 0 ? '+' : '') + fmt(h.m) + '</span></div>';
      }).join('') : '<div class="li muted">Rien pour l\'instant</div>') + '</div>');
    on('[data-a]', 'click', function (el) {
      var a = el.dataset.a;
      if (a === 'credit' || a === 'paiement') go(a, { personne: p.id }); else go('money', { kind: a, personne: p.id });
    });
    on('#rappel', 'click', function () {
      var lst = p.dettes.map(function (x) { return '- ' + dshort(x.jour) + ' : ' + (x.lignes ? x.lignes.map(function (l) { return l.qte + ' ' + (l.nom || A(l.art).nom); }).join(', ') : x.txt.replace('A pris à crédit : ', '')) + ' = ' + fmt(x.reste); }).join('\n');
      var txt = 'Bonjour ' + p.nom + ', petit rappel de la boutique de Mathias :\n' + lst + '\nTotal à payer : ' + fmt(p.solde) + '.\nMerci et que Dieu vous bénisse !';
      window.open((p.tel ? 'https://wa.me/' + p.tel.replace(/\D/g, '') : 'https://wa.me/') + '?text=' + encodeURIComponent(txt), '_blank');
    });
    on('#edit', 'click', function () {
      openSheet('<h3>Modifier</h3><label class="lab">Nom</label><input class="inp" id="eNom" value="' + esc(p.nom) + '">' +
        '<label class="lab">Téléphone</label><input class="inp" id="eTel" inputmode="tel" value="' + esc(p.tel || '') + '">' +
        '<label class="lab">Solde exact (+ s\'il me doit, − si je lui dois)</label><input class="inp" id="eSol" inputmode="numeric" value="' + s + '">' +
        '<button class="btn" id="eOk">Enregistrer</button><button class="btn sec" id="eArch">Retirer du carnet</button>', function (sh) {
          sh.querySelector('#eOk').onclick = function () {
            var n = sh.querySelector('#eNom').value.trim(), t = sh.querySelector('#eTel').value.trim(), so = num(sh.querySelector('#eSol').value.replace('−', '-'));
            if (n && (n !== p.nom || t !== (p.tel || ''))) addEvent({ type: 'personne', p: { id: p.id, nom: n, tel: t } });
            if (so != null && so !== s) addEvent({ type: 'soldePersonne', personne: p.id, solde: so });
            closeSheet(); render(); toast('✅ Modifié');
          };
          sh.querySelector('#eArch').onclick = function () {
            if (s !== 0) { toast('Le solde doit être à zéro avant de retirer cette personne'); return; }
            addEvent({ type: 'personne', p: { id: p.id, archive: true } }); closeSheet(); go('carnet', {}, true);
          };
        });
    });
  };

  // Articles
  SCREENS.articles = function () {
    var arts = S.ordreArticles.map(A).filter(function (a) { return !a.archive; }).sort(function (a, b) { return a.nom.localeCompare(b.nom); });
    var aRacheter = arts.filter(function (a) { return a.stock <= (a.seuil || 0); });
    html('<div class="grid2"><div class="card"><h2>Valeur du stock</h2><div class="mid">' + fmt(S.valeurStock) + '</div></div><div class="card"><h2>À racheter</h2><div class="mid orange">' + aRacheter.length + '</div></div></div>' +
      '<input class="inp search" id="as" placeholder="🔎 Chercher un article…" autocomplete="off">' +
      '<div class="list">' + arts.map(function (a) {
        var marge = a.prix - a.cmup;
        return '<button class="li" data-a="' + a.id + '" data-q="' + esc(a.nom) + '"><span class="grow"><b>' + esc(a.nom) + '</b><div class="muted">Vendu ' + fmt(a.prix) + ' · gagne ' + fmt(marge) + ' / ' + esc((a.unite || 'unité').toLowerCase()) + '</div></span>' +
          '<span style="text-align:right"><b>' + Math.round(a.stock) + '</b><br>' + (a.stock <= (a.seuil || 0) ? '<span class="tag o">à racheter</span>' : '<span class="muted small">en stock</span>') + '</span></button>';
      }).join('') + '</div><button class="btn sec" id="na">＋ Nouvel article</button>');
    filterBind('#as', '[data-q]');
    on('[data-a]', 'click', function (el) { go('article', { id: el.dataset.a }); });
    on('#na', 'click', function () { newArticleSheet(function (id) { go('article', { id: id }); }); });
  };
  SCREENS.article = function () {
    var a = A(cur.p.id);
    var ventes = S.ventes.filter(function (v) { return v.art === a.id; });
    var q30 = 0, m30 = 0, lim = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    ventes.forEach(function (v) { if (v.jour >= lim) { q30 += v.qte; m30 += v.marge; } });
    html('<div class="card"><div class="mid">' + esc(a.nom) + '</div><div class="muted">' + esc(a.unite || '') + ' · ' + esc(a.cat || '') + '</div>' +
      '<div class="kv"><span>En stock (calculé)</span><b>' + Math.round(a.stock) + '</b></div>' +
      '<div class="kv"><span>Dernier comptage</span><b>' + (a.compteLe ? dshort(a.compteLe) : '—') + '</b></div>' +
      '<div class="kv"><span>Coût moyen d\'achat</span><b>' + fmt(a.cmup) + '</b></div>' +
      '<div class="kv"><span>Bénéfice par unité</span><b class="vert">' + fmt(a.prix - a.cmup) + '</b></div>' +
      '<div class="kv"><span>Vendus ces 30 jours</span><b>' + q30 + '</b></div>' +
      '<div class="kv"><span>Bénéfice ces 30 jours</span><b class="vert">' + fmt(m30) + '</b></div></div>' +
      '<label class="lab">Prix de vente</label><input class="inp" id="prix" inputmode="numeric" value="' + Math.round(a.prix) + '">' +
      '<label class="lab">Nom</label><input class="inp" id="nom" style="font-size:18px" value="' + esc(a.nom) + '">' +
      '<label class="lab">Me prévenir quand il en reste</label><input class="inp" id="seuil" inputmode="numeric" value="' + (a.seuil || 0) + '">' +
      '<button class="btn" id="ok">Enregistrer</button><button class="btn sec" id="arch">Je ne vends plus cet article</button>');
    on('#ok', 'click', function () {
      var p = num($('#prix').value), n = $('#nom').value.trim(), se = num($('#seuil').value) || 0;
      if (p == null) return $('#prix').focus();
      var ch = {}; if (p !== a.prix) ch.prix = p; if (n && n !== a.nom) ch.nom = n; if (se !== (a.seuil || 0)) ch.seuil = se;
      if (Object.keys(ch).length) { ch.id = a.id; addEvent({ type: 'article', art: ch }); }
      toast('✅ Article mis à jour'); back();
    });
    on('#arch', 'click', function () { confirmBox('Retirer « ' + esc(a.nom) + ' » de la liste ?', 'Oui, retirer', function () { addEvent({ type: 'article', art: { id: a.id, archive: true } }); go('articles', {}, true); }); });
  };

  // Bilan & dîme
  function periode(code) {
    var t = today(), d = new Date(t + 'T12:00:00');
    function iso(x) { return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); }
    if (code === 'jour') return [t, t, 'Aujourd\'hui'];
    if (code === 'semaine') { var w = new Date(d); w.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [iso(w), t, 'Cette semaine']; }
    if (code === 'mois') return [t.slice(0, 8) + '01', t, 'Ce mois'];
    if (code === 'moisPrec') { var m = new Date(d.getFullYear(), d.getMonth() - 1, 1), f = new Date(d.getFullYear(), d.getMonth(), 0); return [iso(m), iso(f), MOIS[m.getMonth()] + ' ' + m.getFullYear()]; }
    return null;
  }
  SCREENS.bilan = function () {
    form.per = form.per || 'depuis';
    var B, label, lastDime = S.dimes.length ? S.dimes[S.dimes.length - 1] : null;
    if (form.per === 'depuis') {
      var initTs = events[0].ts;
      B = E.bilan(S, null, null, lastDime ? lastDime.ts : initTs);
      label = lastDime ? 'Depuis le dernier versement (' + dshort(lastDime.jour) + ')' : 'Depuis le début de l\'application';
    } else if (form.per === 'perso') {
      form.du = form.du || today().slice(0, 8) + '01'; form.au = form.au || today();
      B = E.bilan(S, form.du, form.au); label = 'Du ' + dshort(form.du) + ' au ' + dshort(form.au);
    } else { var pr = periode(form.per); B = E.bilan(S, pr[0], pr[1]); label = pr[2]; }
    var chips = [['depuis', 'Depuis la dernière dîme'], ['jour', 'Aujourd\'hui'], ['semaine', 'Semaine'], ['mois', 'Ce mois'], ['moisPrec', 'Mois dernier'], ['perso', 'Choisir…']];
    html('<div class="card dime"><h2>🙏 Dîme à verser (tout compris)</h2><div class="row between"><span class="big">' + fmt(Math.max(S.dimeDue, 0)) + '</span><button class="btn inline" style="background:#fff;color:var(--vert)" id="verser">J\'ai versé</button></div></div>' +
      '<div class="chips" style="margin-bottom:10px">' + chips.map(function (c) { return '<button class="chip ' + (form.per === c[0] ? 'on' : '') + '" data-per="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>' +
      (form.per === 'perso' ? '<div class="grid2"><input type="date" class="inp" id="du" style="font-size:16px" value="' + form.du + '"><input type="date" class="inp" id="au" style="font-size:16px" value="' + form.au + '"></div>' : '') +
      '<div class="card"><h2>' + esc(label) + '</h2>' +
      '<div class="kv"><span>Ventes au comptant</span><b>' + fmt(B.ventesComptant) + '</b></div>' +
      '<div class="kv"><span>Ventes à crédit</span><b>' + fmt(B.ventesCredit) + '</b></div>' +
      '<div class="kv"><span><b>Bénéfice sur les ventes</b></span><b class="vert">' + fmt(B.marge) + '</b></div>' +
      '<div class="kv"><span>− Dépenses</span><b>' + fmt(B.depenses) + '</b></div>' +
      '<div class="kv"><span>− Casse / maison</span><b>' + fmt(B.pertes) + '</b></div>' +
      '<div class="kv"><span><b>Bénéfice net</b></span><b class="' + (B.net >= 0 ? 'vert' : 'rouge') + '">' + fmt(B.net) + '</b></div>' +
      '<div class="kv" style="font-size:20px"><span><b>Dîme de la période</b><div class="muted">' + Math.round(S.taux * 100) + ' % du ' + (S.base === 'net' ? 'bénéfice net' : 'bénéfice sur les ventes') + '</div></span><b>' + fmt(B.dime) + '</b></div>' +
      (B.dimeVersee ? '<div class="kv"><span>Dîme déjà versée sur la période</span><b>' + fmt(B.dimeVersee) + '</b></div>' : '') +
      (B.ecartCaisse ? '<div class="kv"><span>Écarts de caisse</span><b class="' + (B.ecartCaisse < 0 ? 'rouge' : 'orange') + '">' + fmt(B.ecartCaisse) + '</b></div>' : '') + '</div>' +
      '<div class="card"><h2>Bénéfice et dîme par article</h2>' + (B.liste.length ? '<table class="t"><tr><th>Article</th><th class="n">Qté</th><th class="n">Bénéfice</th><th class="n">Dîme</th></tr>' +
        B.liste.map(function (x) { return '<tr><td>' + esc(A(x.art).nom) + '</td><td class="n">' + x.qte + '</td><td class="n">' + fmt(x.marge) + '</td><td class="n">' + fmt(Math.max(x.marge, 0) * S.taux) + '</td></tr>'; }).join('') + '</table>' : '<div class="muted">Aucune vente sur cette période.</div>') + '</div>' +
      '<div class="card"><h2>La boutique aujourd\'hui</h2>' +
      '<div class="kv"><span>Argent attendu (espèces + Wave + OM)</span><b>' + fmt(S.caisse.attendu) + '</b></div>' +
      '<div class="kv"><span>Valeur du stock</span><b>' + fmt(S.valeurStock) + '</b></div>' +
      '<div class="kv"><span>On me doit</span><b class="rouge">' + fmt(S.aEncaisser) + '</b></div>' +
      '<div class="kv"><span>Je dois aux personnes</span><b class="orange">' + fmt(S.aRendre) + '</b></div>' +
      '<div class="kv"><span>Je dois aux fournisseurs</span><b class="orange">' + fmt(S.detteFourn) + '</b></div>' +
      '<div class="kv"><span>Épargne mise de côté</span>' + (form.voirEp ? '<b>' + fmt(S.epargne) + '</b>' : '<button class="chip" id="voirEp">•••••  Afficher</button>') + '</div></div>' +
      '<button class="btn sec" id="histo">📜 Toutes mes saisies</button>');
    on('[data-per]', 'click', function (el) { form.per = el.dataset.per; render(); });
    on('#du', 'change', function (el) { form.du = el.value; render(); });
    on('#au', 'change', function (el) { form.au = el.value; render(); });
    on('#verser', 'click', function () { go('dime'); });
    on('#histo', 'click', function () { go('histo'); });
    on('#voirEp', 'click', function () { confirmBox('Afficher le montant de l\'épargne ?', 'Oui, afficher', function () { form.voirEp = true; render(); }); });
  };
  SCREENS.dime = function () {
    html(dateChip() + '<div class="card dime"><h2>Dîme à verser</h2><div class="big">' + fmt(Math.max(S.dimeDue, 0)) + '</div></div>' +
      '<label class="lab">Montant versé</label><input class="inp" id="mt" inputmode="numeric" value="' + Math.max(Math.round(S.dimeDue), 0) + '">' +
      '<label class="lab">Payé comment ?</label>' + modeChips('mode') +
      '<div class="sticky"><button class="btn" id="ok">Enregistrer le versement</button></div>');
    bindDate(); bindModes();
    on('#ok', 'click', function () {
      var m = num($('#mt').value); if (!m || m <= 0) return $('#mt').focus();
      addEvent({ type: 'dime', montant: m, mode: form.mode }, form.jour);
      saved('Dîme de ' + fmt(m) + ' enregistrée. Que Dieu bénisse !', 'bilan');
    });
  };

  // Historique
  SCREENS.histo = function () {
    var list = events.filter(function (e) { return ['annule', 'reglages'].indexOf(e.type) < 0; }).slice().sort(function (a, b) { return a.ts < b.ts ? 1 : -1; });
    form.lim = form.lim || 60;
    var h = '', jour = null;
    list.slice(0, form.lim).forEach(function (e) {
      if (e.jour !== jour) { if (jour) h += '</div>'; jour = e.jour; h += '<div class="daysep">' + dlong(jour) + '</div><div class="list">'; }
      var d = describe(e), ann = S.annules[e.id];
      h += '<div class="li ' + (ann ? 'struck' : '') + '"><span class="ico">' + d[0] + '</span><span class="grow">' + esc(d[1]) + (e.note && e.type === 'comptageCaisse' ? '<div class="muted">' + esc(e.note) + '</div>' : '') + (e.par ? '<div class="muted small">par ' + esc(e.par) + '</div>' : '') + annTxt(ann) + '</span><span class="amt">' + d[2] + '</span>' +
        (!ann && e.type !== 'init' ? '<button class="x" data-ann="' + e.id + '" title="Annuler">↩︎</button>' : '') + '</div>';
    });
    if (jour) h += '</div>';
    if (list.length > form.lim) h += '<button class="btn sec" id="more">Voir plus</button>';
    html('<div class="info">Une erreur ? Touchez ↩︎ pour annuler une saisie, puis refaites-la correctement.</div>' + h);
    on('#more', 'click', function () { form.lim += 100; render(); });
    on('[data-ann]', 'click', function (el) {
      var e = events.filter(function (x) { return x.id === el.dataset.ann; })[0];
      confirmBox('Annuler : « ' + esc(describe(e)[1]) + ' » ?', 'Oui, annuler cette saisie', function () { addEvent({ type: 'annule', ref: e.id }); toast('Saisie annulée'); render(); }, true);
    });
  };

  // Réglages
  SCREENS.reglages = function () {
    var nonEnv = events.filter(function (e) { return !synced[e.id]; }).length;
    html('<div class="card"><h2>📱 Cet appareil</h2><div class="muted">Qui utilise ce téléphone / cet ordinateur ?</div><div class="chips" style="margin-top:6px">' +
      ['Mathias', 'Davy'].map(function (n) { return '<button class="chip ' + (R.appareil === n ? 'on' : '') + '" data-who="' + n + '">' + n + '</button>'; }).join('') + '</div></div>' +
      '<div class="card"><h2>☁️ Sauvegarde Google Sheets</h2>' +
      '<div class="muted">Lien du script Google (fourni par Davy)</div><input class="inp" id="url" style="font-size:14px" value="' + esc(R.syncUrl) + '" placeholder="https://script.google.com/macros/s/…/exec">' +
      '<div class="muted" style="margin-top:8px">Code secret</div><input class="inp" id="tok" style="font-size:16px" value="' + esc(R.token) + '">' +
      '<button class="btn" id="saveSync">Enregistrer et envoyer</button>' +
      '<div class="muted" style="margin-top:8px">' + nonEnv + ' saisie(s) pas encore envoyée(s). ' + (R.lastSync ? 'Dernier envoi : ' + new Date(R.lastSync).toLocaleString('fr-FR') : '') + '</div>' +
      '<div class="muted small" style="margin-top:6px">Les saisies faites sur un autre appareil (Mathias ou Davy) arrivent toutes seules quand il y a du réseau.</div>' +
      '<button class="btn sec" id="restore">Tout récupérer depuis Google</button></div>' +
      '<div class="card"><h2>🙏 Dîme</h2><div class="muted">Taux (%)</div><input class="inp" id="taux" inputmode="numeric" value="' + Math.round(S.taux * 100) + '">' +
      '<div class="muted" style="margin-top:8px">Calculée sur</div><div class="chips"><button class="chip ' + (S.base !== 'net' ? 'on' : '') + '" data-b="marge">Bénéfice sur les ventes</button><button class="chip ' + (S.base === 'net' ? 'on' : '') + '" data-b="net">Bénéfice net (après dépenses)</button></div></div>' +
      '<div class="card"><h2>🔢 Comptage de départ</h2><div class="muted">À utiliser le jour du lancement (ou après une longue pause) : le prochain comptage du stock remettra les quantités à jour sans calculer de ventes.</div>' +
      '<button class="btn ' + (R.depart ? 'danger' : 'light') + '" id="depart">' + (R.depart ? 'Annuler le comptage de départ' : 'Le prochain comptage est un comptage de départ') + '</button></div>' +
      '<div class="card"><h2>💾 Copie de secours</h2><button class="btn light" id="exp">Télécharger une copie (fichier)</button><button class="btn light" id="imp">Charger une copie</button><input type="file" id="file" class="hidden"></div>' +
      '<div class="muted" style="text-align:center">Ma Boutique v' + VERSION + ' · ' + events.length + ' saisies</div>');
    on('[data-who]', 'click', function (el) { R.appareil = el.dataset.who; save('bm_reglages', R); render(); });
    on('#saveSync', 'click', function () { R.syncUrl = $('#url').value.trim(); R.token = $('#tok').value.trim(); save('bm_reglages', R); doSync(true); });
    on('#restore', 'click', function () { R.syncUrl = $('#url').value.trim(); R.token = $('#tok').value.trim(); save('bm_reglages', R); restore(); });
    on('#taux', 'change', function (el) { var t = num(el.value); if (t != null && t >= 0 && t <= 100) { addEvent({ type: 'reglages', taux: t / 100 }); toast('Taux enregistré'); render(); } });
    on('[data-b]', 'click', function (el) { addEvent({ type: 'reglages', base: el.dataset.b }); render(); });
    on('#depart', 'click', function () { R.depart = !R.depart; save('bm_reglages', R); render(); });
    on('#exp', 'click', function () {
      var blob = new Blob([JSON.stringify({ app: 'MaBoutique', version: VERSION, date: new Date().toISOString(), events: events })], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'MaBoutique_copie_' + today() + '.json'; document.body.appendChild(a); a.click(); a.remove();
    });
    on('#imp', 'click', function () { $('#file').click(); });
    on('#file', 'change', function (el) {
      var f = el.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try { var d = JSON.parse(rd.result); if (!d.events || !d.events.length) throw 0; merge(d.events); toast('✅ Copie chargée'); render(); }
        catch (e) { alert('Ce fichier n\'est pas une copie de Ma Boutique.'); }
      };
      rd.readAsText(f);
    });
  };

  function merge(list) {
    if (list.some(function (e) { return e && e.type === 'init'; })) events = events.filter(function (e) { return e.id !== 'init-vierge'; });
    var have = {}; events.forEach(function (e) { have[e.id] = 1; });
    var n = 0; list.forEach(function (e) { if (e && e.id && e.id !== 'init-vierge' && !have[e.id]) { events.push(e); have[e.id] = 1; n++; } });
    save('bm_events', events); S = E.compute(events); return n;
  }

  // ---------- Synchronisation ----------
  var syncing = false, syncTimer, syncErr = '';
  function renderSync() {
    var b = document.getElementById('sync'), n = events.filter(function (e) { return !synced[e.id]; }).length;
    if (!R.syncUrl) { b.textContent = '📱 Hors ligne'; b.className = 'pill'; }
    else if (syncing) { b.textContent = '⏳ Envoi…'; b.className = 'pill'; }
    else if (n) { b.textContent = '📤 ' + n + ' à envoyer'; b.className = 'pill warn'; }
    else { b.textContent = '☁️ À jour'; b.className = 'pill'; }
  }
  document.getElementById('sync').onclick = function () {
    if (!R.syncUrl) { toast('Sauvegarde Google pas encore réglée (voir ⚙︎)'); return; }
    if (!navigator.onLine) { toast('Pas de réseau : vos saisies sont gardées dans le téléphone'); return; }
    doSync(true);
  };
  function syncSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(function () { doSync(false); }, 1500); renderSync(); }
  function resume() {
    return {
      date: new Date().toISOString(), dimeDue: Math.round(S.dimeDue), argentAttendu: Math.round(S.caisse.attendu), onMeDoit: Math.round(S.aEncaisser),
      jeDois: Math.round(S.aRendre), dettesFournisseurs: Math.round(S.detteFourn), valeurStock: Math.round(S.valeurStock), epargne: Math.round(S.epargne),
      personnes: Object.keys(S.personnes).map(P).filter(function (p) { return Math.round(p.solde) !== 0; }).map(function (p) { return [p.nom, Math.round(p.solde)]; }),
      stock: S.ordreArticles.map(A).filter(function (a) { return !a.archive; }).map(function (a) { return [a.nom, Math.round(a.stock), Math.round(a.prix), Math.round(a.cmup)]; })
    };
  }
  function doSync(manual) {
    if (!R.syncUrl || syncing) { renderSync(); return; }
    if (!navigator.onLine) { renderSync(); return; }
    var todo = events.filter(function (e) { return !synced[e.id] && e.id !== 'init-vierge'; }).slice(0, 300);
    syncing = true; renderSync();
    fetch(R.syncUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: R.token, events: todo.map(function (e) { return { id: e.id, ts: e.ts, jour: e.jour, type: e.type, resume: describe(e).slice(1).join(' ') + (e.par ? ' — par ' + e.par : ''), json: JSON.stringify(e) }; }), resume: S.ordreArticles.length ? resume() : null }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'refusé');
        (d.ids || []).forEach(function (id) { synced[id] = 1; }); save('bm_synced', synced);
        if (events.some(function (e) { return !synced[e.id] && e.id !== 'init-vierge'; })) { syncing = false; return doSync(manual); }
        return pull().then(function (n) {
          syncing = false; R.lastSync = Date.now(); save('bm_reglages', R); syncErr = '';
          if (manual) toast(n ? '☁️ À jour — ' + n + ' saisie(s) reçue(s) d\'un autre appareil' : '☁️ Sauvegarde Google à jour');
          if (n || manual) render(); else renderSync();
        });
      })
      .catch(function (err) { syncing = false; syncErr = String(err.message || err); renderSync(); if (manual) toast('Envoi impossible pour l\'instant (' + syncErr + '). Vos saisies restent dans le téléphone.'); });
  }
  // Récupère les saisies faites sur les autres appareils (Mathias, Davy…)
  function pull() {
    var from = R.pullRow || 0;
    return fetch(R.syncUrl + (R.syncUrl.indexOf('?') < 0 ? '?' : '&') + 'action=since&from=' + from + '&token=' + encodeURIComponent(R.token))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || 'refusé');
        var list = (d.events || []).map(function (x) { try { return JSON.parse(x); } catch (e) { return null; } })
          .filter(function (e) { return e && e.id && e.id !== 'init-vierge'; });
        list.forEach(function (e) { synced[e.id] = 1; }); save('bm_synced', synced);
        var n = list.length ? merge(list) : 0;
        R.pullRow = d.next != null ? d.next : from + (d.events || []).length; save('bm_reglages', R);
        return n;
      });
  }
  function restore() {
    if (!R.syncUrl) return toast('Mettez d\'abord le lien du script');
    toast('⏳ Récupération…');
    R.pullRow = 0; save('bm_reglages', R);
    pull().then(function (n) { toast('✅ ' + n + ' saisie(s) récupérée(s)'); render(); })
      .catch(function (err) { toast('Récupération impossible : ' + (err.message || err)); });
  }
  window.addEventListener('online', function () { doSync(false); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) doSync(false); });
  setInterval(function () { doSync(false); }, 90000);

  // ---------- Démarrage ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () { });
  }
  history.replaceState({ name: 'home', p: {} }, '');
  render();
  doSync(false);
  window.BM_DEBUG = { get S() { return S; }, get events() { return events; } };
})();
