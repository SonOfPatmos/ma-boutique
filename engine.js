// Moteur de calcul de "Ma Boutique".
// Tout l'état est recalculé à partir du journal des saisies (événements).
(function (root) {
  'use strict';

  function r0(x) { return Math.round(x || 0); }

  function compute(events) {
    var annules = {};
    events.forEach(function (e) { if (e.type === 'annule') annules[e.ref] = e; });
    var evs = events.filter(function (e) { return e.type !== 'annule' && !annules[e.id]; })
      .slice().sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });

    var S = {
      articles: {}, ordreArticles: [], personnes: {}, fournisseurs: {},
      taux: 0.10, base: 'marge',
      dimeDepart: 0, dimeVersee: 0, epargne: 0,
      caisse: { dernier: null, attendu: 0, depuis: { entrees: 0, sorties: 0, ventes: 0 } },
      ventes: [], depenses: [], pertes: [], dimes: [], caisses: [], flux: [], ecartsStock: [],
      usage: {}, usagePers: {}, derniereDate: null, annules: annules
    };

    function art(id) { return S.articles[id]; }
    function cashIn(e, m, quoi) { S.caisse.attendu += m; S.flux.push({ ts: e.ts, jour: e.jour, montant: m, quoi: quoi }); }
    function cashOut(e, m, quoi) { S.caisse.attendu -= m; S.flux.push({ ts: e.ts, jour: e.jour, montant: -m, quoi: quoi }); }
    function pers(id) {
      if (!S.personnes[id]) S.personnes[id] = { id: id, nom: '?', solde: 0, histo: [] };
      return S.personnes[id];
    }
    function fourn(id) {
      if (!S.fournisseurs[id]) S.fournisseurs[id] = { id: id, nom: '?', dette: 0 };
      return S.fournisseurs[id];
    }
    function use(id) { S.usage[id] = (S.usage[id] || 0) + 1; }
    function useP(id) { S.usagePers[id] = (S.usagePers[id] || 0) + 1; }

    evs.forEach(function (e) {
      S.derniereDate = e.jour;
      switch (e.type) {
        case 'init':
          S.taux = e.taux; S.base = e.base; S.dimeDepart = e.dimeDue || 0; S.epargne = e.epargne || 0;
          (e.articles || []).forEach(function (a) {
            S.articles[a.id] = { id: a.id, nom: a.nom, cat: a.cat, unite: a.unite, prix: a.prix, stock: a.stock, cmup: a.cmup, seuil: a.seuil || 0, archive: false, compteLe: e.jour };
            S.ordreArticles.push(a.id);
          });
          (e.personnes || []).forEach(function (p) {
            S.personnes[p.id] = { id: p.id, nom: p.nom, solde: p.solde, histo: p.solde ? [{ ts: e.ts, jour: e.jour, txt: 'Report du fichier Excel', m: p.solde }] : [] };
          });
          (e.fournisseurs || []).forEach(function (f) { S.fournisseurs[f.id] = { id: f.id, nom: f.nom, dette: f.dette || 0 }; });
          var c = e.caisse || { esp: 0, wave: 0, om: 0 };
          S.caisse.dernier = { ts: e.ts, jour: e.jour, esp: c.esp, wave: c.wave, om: c.om, total: c.esp + c.wave + c.om };
          S.caisse.attendu = S.caisse.dernier.total;
          break;

        case 'reglages':
          if (e.taux != null) S.taux = e.taux;
          if (e.base) S.base = e.base;
          break;

        case 'article':
          var a0 = S.articles[e.art.id];
          if (!a0) {
            a0 = S.articles[e.art.id] = { id: e.art.id, nom: '', cat: '', unite: 'Pièce', prix: 0, stock: 0, cmup: 0, seuil: 0, archive: false };
            S.ordreArticles.push(e.art.id);
          }
          ['nom', 'cat', 'unite', 'prix', 'seuil', 'archive'].forEach(function (k) { if (e.art[k] !== undefined) a0[k] = e.art[k]; });
          if (e.art.cmup !== undefined && !a0.cmup) a0.cmup = e.art.cmup;
          break;

        case 'personne':
          var p0 = pers(e.p.id);
          ['nom', 'tel', 'archive'].forEach(function (k) { if (e.p[k] !== undefined) p0[k] = e.p[k]; });
          break;

        case 'fournisseur':
          var f0 = fourn(e.f.id);
          if (e.f.nom !== undefined) f0.nom = e.f.nom;
          break;

        case 'achat':
          var tot = 0;
          e.lignes.forEach(function (l) {
            var a = art(l.art); if (!a) return;
            var st = Math.max(a.stock, 0);
            a.cmup = (st + l.qte) > 0 ? (st * a.cmup + l.montant) / (st + l.qte) : a.cmup;
            a.stock += l.qte; a.dernierPA = l.qte ? l.montant / l.qte : a.dernierPA;
            tot += l.montant; use(l.art);
          });
          var paye = e.paye == null ? tot : e.paye;
          if (paye) cashOut(e, paye, 'Achat');
          if (tot - paye && e.fournisseur) fourn(e.fournisseur).dette += tot - paye;
          break;

        case 'credit':
          var p = pers(e.personne), totc = 0, noms = [];
          e.lignes.forEach(function (l) {
            var a = art(l.art); if (!a) return;
            var mt = l.qte * l.prix, cout = l.qte * a.cmup;
            a.stock -= l.qte; totc += mt; use(l.art);
            noms.push(l.qte + ' ' + a.nom);
            S.ventes.push({ ts: e.ts, jour: e.jour, art: l.art, qte: l.qte, montant: mt, cout: cout, marge: mt - cout, mode: 'credit', personne: e.personne });
          });
          p.solde += totc; useP(e.personne);
          p.histo.push({ ts: e.ts, jour: e.jour, txt: 'A pris à crédit : ' + noms.join(', '), m: totc, id: e.id });
          break;

        case 'paiement':
          var pp = pers(e.personne); pp.solde -= e.montant; useP(e.personne);
          pp.histo.push({ ts: e.ts, jour: e.jour, txt: 'A payé (' + (e.mode || 'Espèces') + ')', m: -e.montant, id: e.id });
          cashIn(e, e.montant, 'Paiement de ' + pp.nom);
          break;

        case 'pret':
          var pr = pers(e.personne); pr.solde += e.montant; useP(e.personne);
          pr.histo.push({ ts: e.ts, jour: e.jour, txt: 'Je lui ai prêté / donné de l\'argent' + (e.note ? ' — ' + e.note : ''), m: e.montant, id: e.id });
          cashOut(e, e.montant, 'Prêt à ' + pr.nom);
          break;

        case 'garde':
          var pg = pers(e.personne); pg.solde -= e.montant; useP(e.personne);
          pg.histo.push({ ts: e.ts, jour: e.jour, txt: 'M\'a remis de l\'argent (à lui rendre)' + (e.note ? ' — ' + e.note : ''), m: -e.montant, id: e.id });
          cashIn(e, e.montant, 'Argent reçu de ' + pg.nom);
          break;

        case 'rendu':
          var prd = pers(e.personne); prd.solde += e.montant; useP(e.personne);
          prd.histo.push({ ts: e.ts, jour: e.jour, txt: 'Je lui ai rendu / remis de l\'argent' + (e.note ? ' — ' + e.note : ''), m: e.montant, id: e.id });
          cashOut(e, e.montant, 'Rendu à ' + prd.nom);
          break;

        case 'soldePersonne':
          var ps = pers(e.personne), diff = e.solde - ps.solde; ps.solde = e.solde;
          ps.histo.push({ ts: e.ts, jour: e.jour, txt: 'Solde corrigé', m: diff, id: e.id });
          break;

        case 'paiementFournisseur':
          fourn(e.fournisseur).dette -= e.montant;
          cashOut(e, e.montant, 'Paiement fournisseur');
          break;

        case 'depense':
          S.depenses.push({ ts: e.ts, jour: e.jour, montant: e.montant, cat: e.cat, note: e.note });
          cashOut(e, e.montant, 'Dépense');
          break;

        case 'perte':
          e.lignes.forEach(function (l) {
            var a = art(l.art); if (!a) return;
            a.stock -= l.qte;
            S.pertes.push({ ts: e.ts, jour: e.jour, art: l.art, qte: l.qte, valeur: l.qte * a.cmup, raison: e.raison });
          });
          break;

        case 'prelevement': cashOut(e, e.montant, 'Pris pour moi'); break;
        case 'apport': cashIn(e, e.montant, 'Argent ajouté'); break;
        case 'epargne':
          S.epargne += e.sens * e.montant;
          if (e.sens > 0) cashOut(e, e.montant, 'Mis de côté'); else cashIn(e, e.montant, 'Repris de l\'épargne');
          break;

        case 'dime':
          S.dimeVersee += e.montant; S.dimes.push({ ts: e.ts, jour: e.jour, montant: e.montant });
          cashOut(e, e.montant, 'Dîme versée');
          break;

        case 'comptageStock':
          Object.keys(e.comptes).forEach(function (id) {
            var a = art(id); if (!a) return;
            var compte = e.comptes[id], diff = a.stock - compte;
            if (!e.depart && diff > 0) {
              var mt = diff * a.prix, cout = diff * a.cmup;
              S.ventes.push({ ts: e.ts, jour: e.jour, art: id, qte: diff, montant: mt, cout: cout, marge: mt - cout, mode: 'comptant' });
              cashIn(e, mt, 'Ventes au comptant');
            } else if (!e.depart && diff < 0) {
              S.ecartsStock.push({ ts: e.ts, jour: e.jour, art: id, qte: -diff });
            }
            a.stock = compte; a.compteLe = e.jour;
          });
          break;

        case 'comptageCaisse':
          var tc = (e.esp || 0) + (e.wave || 0) + (e.om || 0);
          var ec = tc - S.caisse.attendu;
          S.caisses.push({ ts: e.ts, jour: e.jour, id: e.id, attendu: S.caisse.attendu, total: tc, ecart: ec, esp: e.esp, wave: e.wave, om: e.om, note: e.note });
          S.caisse.dernier = { ts: e.ts, jour: e.jour, esp: e.esp, wave: e.wave, om: e.om, total: tc };
          S.caisse.attendu = tc;
          break;
      }
    });

    // Dîme
    var margeTot = S.ventes.reduce(function (s, v) { return s + v.marge; }, 0);
    var depTot = S.depenses.reduce(function (s, v) { return s + v.montant; }, 0);
    var perteTot = S.pertes.reduce(function (s, v) { return s + v.valeur; }, 0);
    var baseTot = S.base === 'net' ? margeTot - depTot - perteTot : margeTot;
    S.dimeDue = r0(S.dimeDepart + Math.max(baseTot, 0) * S.taux - S.dimeVersee);
    S.aEncaisser = 0; S.aRendre = 0;
    Object.keys(S.personnes).forEach(function (k) {
      var p = S.personnes[k];
      if (p.solde > 0) S.aEncaisser += p.solde; else S.aRendre -= p.solde;
    });
    S.detteFourn = Object.keys(S.fournisseurs).reduce(function (s, k) { return s + Math.max(S.fournisseurs[k].dette, 0); }, 0);
    S.valeurStock = S.ordreArticles.reduce(function (s, id) { var a = S.articles[id]; return s + Math.max(a.stock, 0) * a.cmup; }, 0);
    S.ecartCaisseTotal = S.caisses.reduce(function (s, c) { return s + c.ecart; }, 0);
    return S;
  }

  // Bilan sur une période [du, au] (dates 'AAAA-MM-JJ' incluses) ou depuis un horodatage
  function bilan(S, du, au, depuisTs) {
    function dans(x) { return depuisTs ? x.ts > depuisTs : (x.jour >= du && x.jour <= au); }
    var B = { ventesComptant: 0, ventesCredit: 0, marge: 0, cout: 0, depenses: 0, pertes: 0, dimeVersee: 0, parArticle: {}, ecartCaisse: 0 };
    S.ventes.filter(dans).forEach(function (v) {
      if (v.mode === 'credit') B.ventesCredit += v.montant; else B.ventesComptant += v.montant;
      B.marge += v.marge; B.cout += v.cout;
      var pa = B.parArticle[v.art] || (B.parArticle[v.art] = { art: v.art, qte: 0, montant: 0, marge: 0 });
      pa.qte += v.qte; pa.montant += v.montant; pa.marge += v.marge;
    });
    S.depenses.filter(dans).forEach(function (d) { B.depenses += d.montant; });
    S.pertes.filter(dans).forEach(function (d) { B.pertes += d.valeur; });
    S.dimes.filter(dans).forEach(function (d) { B.dimeVersee += d.montant; });
    S.caisses.filter(dans).forEach(function (c) { B.ecartCaisse += c.ecart; });
    B.ventes = B.ventesComptant + B.ventesCredit;
    B.net = B.marge - B.depenses - B.pertes;
    B.baseDime = S.base === 'net' ? B.net : B.marge;
    B.dime = r0(Math.max(B.baseDime, 0) * S.taux);
    B.liste = Object.keys(B.parArticle).map(function (k) { return B.parArticle[k]; })
      .sort(function (a, b) { return b.marge - a.marge; });
    return B;
  }

  var api = { compute: compute, bilan: bilan };
  if (typeof module !== 'undefined') module.exports = api; else root.BM_ENGINE = api;
})(this);
