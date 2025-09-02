// card-engine/scripts/module.js
const MOD = "card-engine";

/*
 * DB structure:
 * - master: master DB cards [{id, name}]
 * - cards: loose cards in pool [{id, name}]
 * - decks: [{ id, name, cards: [cardId] }]
 * - hands: [{ id, name, cards: [cardId], discard: [cardId], srcDeckId?: string }]
 * - index: { [id]: name }           // canonical names
 * - images:{ [id]: imgPath }        // canonical image per card
 * - meta:  { [id]: { type, rarity, rules, tags } } // rules is HTML, tags is string[]
 * - packImages: { [packType]: imgPath } // booster tile images by type
 */
const DB = {
    master: [],
    cards: [],
    decks: [],
    hands: [],
    index: {},
    images: {},
    meta: {},
    packImages: {}
};

const PACK_TYPES = [
  { key: "Universal", tag: "Universal" }, // only cards tagged 'Universal'
    { key: "Bullet",    tag: "Bullet" },
{ key: "Scope",     tag: "Scope" },
{ key: "Trigger",   tag: "Trigger" },
{ key: "Jacket",    tag: "Jacket" }
];

function uid() { return randomID(); } // Foundry v13 global
function cardName(n) { return `Card ${n}`; }

/* ------------------------------ INIT ------------------------------ */
Hooks.once("init", () => {
    game.settings.register(MOD, "db", {
        name: "Card Engine DB",
        scope: "world",
        config: false,
        type: Object,
        default: { master: [], cards: [], decks: [], hands: [], index: {}, images: {}, meta: {}, packImages: {} }
    });
    // Default images for the 10 hand slots (world-scoped, hidden config)
    game.settings.register(MOD, "slotDefaults", {
        name: "Slot default images",
        scope: "world",
        config: false,   // hidden from UI; set via console or code
        type: Array,
        default: Array(10).fill("")
    });


    /* ---- Rarity meta + helpers ---- */
    const RARITY_META = {
        "Common":    { cls: "rarity-common",    color: "#ffffff" },
        "Uncommon":  { cls: "rarity-uncommon",  color: "#22c55e" },
        "Rare":      { cls: "rarity-rare",      color: "#3b82f6" },
        "Set":       { cls: "rarity-set",       color: "#ec4899" },
        "Legendary": { cls: "rarity-legendary", color: "#ef4444" },
        "Unique":    { cls: "rarity-unique",    color: "#ffd54a" }
    };

    Handlebars.registerHelper('rarityClass', (cardId) => {
        const r = DB.meta[cardId]?.rarity || "Common";
        return RARITY_META[r]?.cls || RARITY_META["Common"].cls;
    });

    Handlebars.registerHelper('lookupCardRarity', (cardId) => DB.meta[cardId]?.rarity || "Common");

    Handlebars.registerHelper('rarityIcon', (cardId) => {
        const r = DB.meta[cardId]?.rarity || "Common";
        const color = (RARITY_META[r]?.color || "#fff");
        let svg = "";
        if (r === "Common") svg = `<svg viewBox="0 0 24 24" aria-label="Common"><circle cx="12" cy="12" r="7" fill="${color}"/></svg>`;
        else if (r === "Uncommon") svg = `<svg viewBox="0 0 24 24" aria-label="Uncommon"><rect x="6" y="6" width="12" height="12" fill="${color}"/></svg>`;
        else if (r === "Rare") svg = `<svg viewBox="0 0 24 24" aria-label="Rare"><polygon points="12,4 20,12 12,20 4,12" fill="${color}"/></svg>`;
        else if (r === "Set") svg = `<svg viewBox="0 0 24 24" aria-label="Set"><polygon points="12,3 15,10 22,10 16.5,14 18.5,21 12,17 5.5,21 7.5,14 2,10 9,10" fill="${color}"/></svg>`;
        else if (r === "Legendary") svg = `<svg viewBox="0 0 24 24" aria-label="Legendary"><polygon points="7,4 17,4 22,12 17,20 7,20 2,12" fill="${color}"/></svg>`;
        else if (r === "Unique") svg = `<svg viewBox="0 0 24 24" aria-label="Unique (Sun Disc)">
            <circle cx="12" cy="12" r="5" fill="${color}"/>
            <rect x="11" y="2"  width="2" height="4"  fill="${color}"/>
            <rect x="11" y="18" width="2" height="4"  fill="${color}"/>
            <rect x="2"  y="11" width="4" height="2"  fill="${color}"/>
            <rect x="18" y="11" width="4" height="2"  fill="${color}"/>
            <polygon points="5,5 6.5,6.5 5,8 3.5,6.5"   fill="${color}"/>
            <polygon points="19,5 20.5,6.5 19,8 17.5,6.5" fill="${color}"/>
            <polygon points="5,19 6.5,17.5 8,19 6.5,20.5" fill="${color}"/>
            <polygon points="19,19 17.5,17.5 19,16 20.5,17.5" fill="${color}"/>
            </svg>`;
        else svg = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="${color}"/></svg>`;
        return new Handlebars.SafeString(svg);
    });

    /* ---- Template helpers ---- */
    Handlebars.registerHelper('lookupDeckCards', function(deckId) {
        const deck = DB.decks.find(d => d.id === deckId);
        if (!deck) return [];
        const seen = new Set(); const result = [];
        for (const cid of (deck.cards ?? [])) {
            if (!cid || seen.has(cid)) continue;
            seen.add(cid);
            result.push({ id: cid, name: DB.index[cid] || `Card ${String(cid).slice(0,4)}`, img: DB.images[cid] });
        }
        return result;
    });

    Handlebars.registerHelper('lookupCardImg', (cardId) => DB.images[cardId]);
    Handlebars.registerHelper('lookupCardName', (cardId) => DB.index[cardId] || `Card ${String(cardId).slice(0,4)}`);
    Handlebars.registerHelper('rulesHTML', function(cardId, options) {
        const root = options?.data?.root || {}; const map = root.rulesHTML || {};
        return new Handlebars.SafeString(map[cardId] || "");
    });
    Handlebars.registerHelper('lookupCardTags', (cardId) => {
        return DB.meta[cardId]?.tags || [];
    });

    Handlebars.registerHelper('firstTag', (tags) => {
        if (!tags || !tags.length) return "";
        return tags[0];
    });

    Handlebars.registerHelper('activeTabClass', (tab, active) => (tab === active ? 'active' : ''));
    Handlebars.registerHelper('selIfEq', (a, b) => String(a ?? "") === String(b ?? "") ? 'selected' : '');
    Handlebars.registerHelper('inc', (v) => Number(v) + 1);


});
// Helper: always return an array of length 10
function getSlotDefaults() {
    const arr = game.settings.get(MOD, "slotDefaults") || [];
    const out = Array(10).fill("");
    for (let i = 0; i < 10; i++) out[i] = arr[i] || "";
    return out;
}
/* ------------------------------ DB IO ------------------------------ */
async function loadDB() {
    const saved = await game.settings.get(MOD, "db");
    DB.master   = saved?.master   ?? [];
    DB.cards    = saved?.cards    ?? [];
    DB.decks    = saved?.decks    ?? [];

    const defaults = getSlotDefaults();

    DB.hands    = (saved?.hands ?? []).map(h => ({
        id: h.id,
        name: h.name,
        cards: h.cards ?? [],
        discard: h.discard ?? [],
        srcDeckId: h.srcDeckId ?? "",
        collapsed: !!h.collapsed,
        // always 10 slots
        slots: Array.isArray(h.slots) ? h.slots.slice(0,10).map(v => v || "") : Array(10).fill(""),
                                                 // prefer saved image; otherwise use default for that index
                                                 slotImages: Array.from({length:10}, (_, i) =>
                                                 (Array.isArray(h.slotImages) && h.slotImages[i]) || defaults[i] || ""
                                                 )
    }));

    DB.index    = saved?.index    ?? {};
    DB.images   = saved?.images   ?? {};
    DB.meta     = saved?.meta     ?? {};
    DB.packImages = saved?.packImages ?? {};
}


async function saveDB() {
    await game.settings.set(MOD, "db", {
        master: DB.master,
        cards: DB.cards,
        decks: DB.decks,
        hands: DB.hands,
        index: DB.index,
        images: DB.images,
        meta: DB.meta,
        packImages: DB.packImages
    });
}

/* Repair duplicates and container ownership
 *   Precedence: Hand (hand.cards + hand.discard) > Deck > Pool
 */
function repairDB() {
    // Decks
    const deckCardSet = new Set();
    for (const d of DB.decks) {
        const seen = new Set();
        d.cards = (d.cards ?? []).filter(cid => {
            if (!cid || seen.has(cid)) return false;
            seen.add(cid); deckCardSet.add(cid); return true;
        });
    }

    // Hands: both zones own cards
    const handOwnedSet = new Set();
    for (const h of DB.hands) {
        const seenHand = new Set();
        h.cards = (h.cards ?? []).filter(cid => { if (!cid || seenHand.has(cid)) return false; seenHand.add(cid); handOwnedSet.add(cid); return true; });

        const seenDisc = new Set();
        h.discard = (h.discard ?? []).filter(cid => { if (!cid || seenDisc.has(cid)) return false; seenDisc.add(cid); handOwnedSet.add(cid); return true; });

        // NEW: slots (one card per slot)
        if (!Array.isArray(h.slots)) h.slots = Array(10).fill("");
        if (!Array.isArray(h.slotImages)) h.slotImages = Array(10).fill("");
        h.slots = h.slots.slice(0,10).map(cid => {
            if (!cid) return "";
            handOwnedSet.add(cid);
            return cid;
        });
    }


    // Pool: dedupe, exclude anything owned elsewhere
    const seenPool = new Set();
    DB.cards = (DB.cards ?? []).filter(c => {
        if (!c?.id) return false;
        if (handOwnedSet.has(c.id)) return false;
        if (deckCardSet.has(c.id)) return false;
        if (seenPool.has(c.id)) return false;
        seenPool.add(c.id);
        return true;
    });

    // Remove overlaps: hands > decks > pool
    for (const d of DB.decks) d.cards = d.cards.filter(cid => !handOwnedSet.has(cid));

    // Master: dedupe by id only
    const seenMaster = new Set();
    DB.master = (DB.master ?? []).filter(c => {
        if (!c?.id) return false;
        if (seenMaster.has(c.id)) return false;
        seenMaster.add(c.id); return true;
    });

    // Prune maps
    const allIds = new Set([
        ...DB.master.map(c => c.id),
                           ...DB.cards.map(c => c.id),
                           ...DB.decks.flatMap(d => d.cards),
                           ...DB.hands.flatMap(h =>
                           (h.cards ?? [])
                           .concat(h.discard ?? [])
                           .concat((h.slots ?? []).filter(Boolean))
                           ),
    ]);
    for (const k of Object.keys(DB.index))  if (!allIds.has(k))  delete DB.index[k];
    for (const k of Object.keys(DB.meta))   if (!allIds.has(k))  delete DB.meta[k];
    for (const k of Object.keys(DB.images)) if (!allIds.has(k))  delete DB.images[k];
}

/* ------------------------------ APP ------------------------------ */
class CardEngineApp extends Application {
    constructor(...args) {
        super(...args);
        this._search = "";
        this._sort = "name-asc";
        this._pileSearch = "";          // NEW: piles (decks/hands) filter
        this._showBoosters = true; // NEW
        this._showMaster = true;
        this._showPool = true;
        this._showPiles = true;
        this._activePileTab = 'decks'; // 'decks' | 'hands'
        // debounce/restore for search UX
        this._searchTimer = null;
        this._searchHadFocus = false;
        this._searchSelStart = null;
        this._searchSelEnd = null;
                // NEW: caret state for pile search
                this._pileTimer = null;
                this._pileHadFocus = false;
                this._pileSelStart = null;
                this._pileSelEnd = null;
        // scroll anchor
        this._afterRenderAnchor = null;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "card-engine-app",
            template: `modules/${MOD}/templates/card-engine.html`,
            title: "Card Engine",
            width: 1180,
            height: 600,
            resizable: true,
            minimizable: true,
            popOut: true
        });
    }

    /* ---------- search/sort helpers ---------- */
    _rarityRank(r) {
        const order = ["Common","Uncommon","Rare","Set","Legendary","Unique"];
        const i = order.indexOf(r || "Common"); return i >= 0 ? i : 0;
    }
    _matchesSearch(cardId, name, meta, search) {
        if (!search) return true;
        const r = (meta?.rarity || "Common");
        const t = (meta?.type || "");
        const tags = (meta?.tags || []).join(' ');
        const hay = `${name} ${t} ${r} ${tags}`.toLowerCase();
        return hay.includes(search);
    }
    _sorter(sortKey) {
        return (a, b) => {
            const nameA = (a.name || "").toLowerCase();
            const nameB = (b.name || "").toLowerCase();
            const metaA = DB.meta[a.id] || {};
            const metaB = DB.meta[b.id] || {};
            const typeA = (metaA.type || "").toLowerCase();
            const typeB = (metaB.type || "").toLowerCase();
            const rA = this._rarityRank(metaA.rarity);
            const rB = this._rarityRank(metaB.rarity);
            switch (sortKey) {
                case "name-asc":  return nameA.localeCompare(nameB);
                case "name-desc": return nameB.localeCompare(nameA);
                case "type-asc":  return typeA.localeCompare(typeB) || nameA.localeCompare(nameB);
                case "type-desc": return typeB.localeCompare(typeA) || nameB.localeCompare(nameA);
                case "rarity-asc":  return rA - rB || nameA.localeCompare(nameB);
                case "rarity-desc": return rB - rA || nameB.localeCompare(nameA);
                default: return nameA.localeCompare(nameB);
            }
        };
    }

    // Precompute sanitized views + enriched rules HTML, then filter/sort
    async getData() {
        repairDB();

        const makeItems = (idsOrObjs) => {
            return idsOrObjs.map(c => {
                const id = typeof c === 'object' ? c.id : c;
                return { id, name: DB.index[id] || (typeof c === 'object' && c.name) || `Card ${String(id).slice(0,4)}`, img: DB.images[id] };
            });
        };

        const sorter = this._sorter(this._sort || "name-asc");
        const search = (this._search || "").toLowerCase();

        const masterItems = makeItems(DB.master)
        .filter(c => this._matchesSearch(c.id, c.name, DB.meta[c.id], search)).sort(sorter);

        const poolItems = makeItems(DB.cards)
        .filter(c => this._matchesSearch(c.id, c.name, DB.meta[c.id], search)).sort(sorter);

        const decksRaw = DB.decks.map(d => {
            const seen = new Set(); const ids = [];
            for (const cid of d.cards) { if (!cid || seen.has(cid)) continue; seen.add(cid); ids.push(cid); }
            const items = makeItems(ids).filter(c => this._matchesSearch(c.id, c.name, DB.meta[c.id], search)).sort(sorter);
            return { ...d, collapsed: !!d.collapsed, count: items.length, cards: items.map(c => c.id), _cardsForRender: items };
        });

        // Hands: hand & discard zones
        const handsRaw = DB.hands.map(h => {
            const uniq = (arr=[]) => { const s=new Set(), out=[]; for (const x of arr) { if (!x || s.has(x)) continue; s.add(x); out.push(x); } return out; };
            const idsHand = uniq(h.cards);
            const itemsHand = makeItems(idsHand).filter(c => this._matchesSearch(c.id, c.name, DB.meta[c.id], search)).sort(sorter);
            const idsDiscard = uniq(h.discard);
            const itemsDiscard = makeItems(idsDiscard).filter(c => this._matchesSearch(c.id, c.name, DB.meta[c.id], search)).sort(sorter);

            // Map 10 slots: for each index, include { img, card?: {id,img} }
            const defaults = getSlotDefaults();

            const _slotsForRender = Array.from({length:10}, (_, i) => {
                const cid = h.slots?.[i] || "";
                const hasCard = !!cid && (DB.index[cid] || DB.images[cid] || DB.meta[cid]);
                return {
                    img: (h.slotImages?.[i] || defaults[i] || ""),
                                               card: hasCard ? { id: cid, img: DB.images[cid] || null } : null
                };
            });

            return {
                ...h,
                collapsed: !!h.collapsed,
                count: itemsHand.length,
                discard: idsDiscard,
                discardCount: itemsDiscard.length,
                cards: itemsHand.map(c => c.id),
                                   _cardsForRender: itemsHand,
                                   _discardForRender: itemsDiscard,
                                   _slotsForRender
            };
        });

                // --- NEW: filter piles (by deck/hand name only) ---
                const pileNeedle = (this._pileSearch || "").toLowerCase();
                const decks = !pileNeedle ? decksRaw
                                          : decksRaw.filter(d => (d.name || "").toLowerCase().includes(pileNeedle));
                const hands = !pileNeedle ? handsRaw
                                          : handsRaw.filter(h => (h.name || "").toLowerCase().includes(pileNeedle));


        // Booster packs
        const boosters = PACK_TYPES.map(p => ({
            key: p.key,
            label: p.key,
            img: DB.packImages[p.key] || null
        }));

        const active = this._activePileTab || 'decks';
        const tabs = { isDecks: active === 'decks', isHands: active === 'hands' };

        // Precompute enriched rules HTML for tooltips
        const rulesHTML = {};
        for (const id of Object.keys(DB.index)) {
            const raw = DB.meta[id]?.rules || "";
            rulesHTML[id] = await TextEditor.enrichHTML(raw, { async: true, secrets: false, entities: true, links: true, rolls: true });
        }
        this._rulesHTML = rulesHTML;

        return {
            showBoosters: this._showBoosters,
            showMaster: this._showMaster,
            showPool: this._showPool,
            showPiles: this._showPiles,
            activePileTab: active,
            tabs,
            boosters,
            master: masterItems,
            masterFiltered: masterItems,
            cards: poolItems,
            decks, hands,
            selectDecks: DB.decks.map(d => ({ id: d.id, name: d.name })),
            rulesHTML
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        /* ---------- scroll-anchor helpers (Deck or Hand) ---------- */
        if (!this._anchorHelpersInstalled) {
            this._anchorHelpersInstalled = true;
            this._setAfterRenderAnchorFromEvent = (ev) => {
                const src = ev?.currentTarget || ev?.target || null;
                const node = src && src.closest ? src.closest('.ce-hand, .ce-deck') : null;
                if (!node) return this._afterRenderAnchor = null;
                const isHand = node.classList.contains('ce-hand');
                const isDeck = node.classList.contains('ce-deck');
                this._afterRenderAnchor = isHand
                ? { kind: 'hand', id: node.dataset.handId }
                : isDeck
                ? { kind: 'deck', id: node.dataset.deckId }
                : null;
            };
            this._setAfterRenderAnchorFromElement = (el) => {
                const node = el && el.closest ? el.closest('.ce-hand, .ce-deck') : null;
                if (!node) return this._afterRenderAnchor = null;
                const isHand = node.classList.contains('ce-hand');
                const isDeck = node.classList.contains('ce-deck');
                this._afterRenderAnchor = isHand
                ? { kind: 'hand', id: node.dataset.handId }
                : isDeck
                ? { kind: 'deck', id: node.dataset.deckId }
                : null;
            };
            this._scrollToAnchor = () => {
                if (!this._afterRenderAnchor) return;
                const root = this.element?.[0];
                const sel = this._afterRenderAnchor.kind === 'deck'
                ? `.ce-deck[data-deck-id="${this._afterRenderAnchor.id}"]`
                : `.ce-hand[data-hand-id="${this._afterRenderAnchor.id}"]`;
                const target = root?.querySelector?.(sel);
                if (target) { try { target.scrollIntoView({ block: 'nearest' }); } catch(_) {} }
                this._afterRenderAnchor = null;
            };
        }
        // REMOVE this if you added it earlier:
        // if (this._slotCtx) this._slotCtx.destroy?.();
        // this._slotCtx = new ContextMenu(html, '.ce-slot', [ ... ]);

        // FIRST: special case — Ctrl+Right-click on a slot returns the slot's card
        html.on('contextmenu', '.ce-slot, .ce-slot *', async ev => {
            if (!ev.ctrlKey) return;                      // only act on Ctrl+Right-click
            const el = ev.target.closest('.ce-slot'); if (!el) return;
            ev.preventDefault(); ev.stopPropagation();

            const handId = el.dataset.handId;
            const idx    = Number(el.dataset.slotIdx ?? -1);
            const hand   = DB.hands.find(h => h.id === handId);
            const cid    = (idx >= 0 && hand) ? (hand.slots?.[idx] || "") : "";
            if (!handId || !cid) return;

            await this._returnCardToLinkedDeck(handId, cid);
            repairDB(); await saveDB(); this.render(true);
        });

        // Ctrl+Right-click on a card in Hand/Discard (or a slot-card) returns it to linked deck
        html.on('contextmenu', '.ce-hand-body .ce-card, .ce-hand-discard-body .ce-card, .ce-slot .ce-slot-card', async ev => {
            if (!ev.ctrlKey) return;
            ev.preventDefault(); ev.stopPropagation();

            const handEl = ev.target.closest('.ce-hand');
            const handId = handEl?.dataset.handId;
            const cardEl = ev.target.closest('.ce-card, .ce-slot-card');
            const cardId = cardEl?.dataset.cardId;
            if (!handId || !cardId) return;

            await this._returnCardToLinkedDeck(handId, cardId);
            repairDB(); await saveDB(); this.render(true);
        });


        html.on('contextmenu', '.ce-slot, .ce-slot *', async ev => {
            ev.preventDefault();
            ev.stopPropagation();

            const el = ev.target.closest('.ce-slot');
            if (!el) return;

            const handId = el.dataset.handId;
            const idx = Number(el.dataset.slotIdx ?? -1);
            const hand = DB.hands.find(h => h.id === handId);
            if (!hand || idx < 0 || idx > 9) return;

            // Quick actions via modifiers (optional but handy)
            // Alt = clear slot image, Shift = clear card from slot
            if (ev.altKey) {
                hand.slotImages = hand.slotImages || Array(10).fill("");
                hand.slotImages[idx] = "";
                await saveDB(); this.render(true);
                return;
            }
            if (ev.shiftKey) {
                hand.slots = hand.slots || Array(10).fill("");
                hand.slots[idx] = "";
                repairDB(); await saveDB(); this.render(true);
                return;
            }

            // Default: open image picker for this slot
            const picker = new FilePicker({
                type: 'image',
                current: hand.slotImages?.[idx] || 'icons/',
                callback: async (path) => {
                    hand.slotImages = hand.slotImages || Array(10).fill("");
                    hand.slotImages[idx] = path;
                    await saveDB(); this.render(true);
                }
            });
            picker.render(true);
        });



        // Header toggles
        html.on('click', '#ce-toggle-boosters', () => { this._showBoosters = !this._showBoosters; this.render(true); });
        html.on('click', '#ce-toggle-master',   () => { this._showMaster   = !this._showMaster;   this.render(true); });
        html.on('click', '#ce-toggle-pool',     () => { this._showPool     = !this._showPool;     this.render(true); });
        html.on('click', '#ce-toggle-piles',    () => { this._showPiles    = !this._showPiles;    this.render(true); });

        // Piles tabs (Decks | Hands)
        html.on('click', '.ce-tab', ev => {
            const tab = ev.currentTarget.dataset.tab;
            if (!tab) return;
            this._activePileTab = tab;
            this.render(true);
        });

        // Create master card
        html.on('click', '#ce-create-master-card', async () => {
            const id = uid();
            const name = cardName(Object.keys(DB.index).length + 1);
            DB.master.push({ id, name });
            DB.index[id] = name;
            DB.images[id] = DB.images[id] ?? null;
            DB.meta[id]   = DB.meta[id]   ?? { type: "", rarity: "Common", rules: "", tags: [] };
            repairDB(); await saveDB(); this.render(true);
        });

        // Create deck
        html.on('click', '#ce-create-deck', async () => {
            const id = uid();
            const name = `Deck ${DB.decks.length + 1}`;
            DB.decks.push({ id, name, cards: [] });
            await saveDB();
            this._afterRenderAnchor = { kind: 'deck', id };
            this.render(true);
        });

        // Deck header actions
        html.on('click', '.ce-deck-action', async ev => {
            ev.preventDefault(); ev.stopPropagation();
            this._setAfterRenderAnchorFromEvent(ev);

            const btn = ev.currentTarget;
            const deckEl = btn.closest('.ce-deck');
            const action = btn.dataset.action;
            const deckId = deckEl?.dataset.deckId;
            if (!deckId || !action) return;

            const deck = DB.decks.find(d => d.id === deckId);
            if (!deck) return;

                        if (action === 'collapse') {
                                deck.collapsed = !deck.collapsed;
                                await saveDB();
                                this.render(true);
                                return;
                            }

            if (action === 'rename') {
                const newName = await Dialog.prompt({
                    title: 'Rename Deck',
                    content: `<form><p>Deck Name:</p><input type="text" name="name" value="${foundry.utils.escapeHTML(deck.name)}"/></form>`,
                                                    label: 'OK',
                                                    callback: (h) => {
                                                        const jq = window.jQuery;
                                                        const $h = jq && h instanceof jq ? h : jq(h);
                                                        const val = $h.find('input[name="name"]').val();
                                                        return (typeof val === 'string' ? val.trim() : '') || deck.name;
                                                    }
                });
                if (newName && newName !== deck.name) deck.name = newName;
            }

            if (action === 'clear') {
                for (const cid of deck.cards) {
                    if (!DB.cards.find(c => c.id === cid))
                        DB.cards.push({ id: cid, name: DB.index[cid] || `Card ${String(cid).slice(0,4)}` });
                }
                deck.cards = [];
            }

            if (action === 'delete') {
                for (const cid of deck.cards) {
                    if (!DB.cards.find(c => c.id === cid))
                        DB.cards.push({ id: cid, name: DB.index[cid] || `Card ${String(cid).slice(0,4)}` });
                }
                DB.decks = DB.decks.filter(d => d.id !== deckId);
            }

            repairDB(); await saveDB(); this.render(true);
        });

        // Create Hand
        html.on('click', '#ce-create-hand', async () => {
            const id = uid();
            const name = `Hand ${DB.hands.length + 1}`;
            DB.hands.push({
                id, name,
                cards: [],
                discard: [],
                srcDeckId: "",
                slots: Array(10).fill(""),
                          slotImages: getSlotDefaults().slice(0,10)
            });
            await saveDB(); this.render(true);
        });


        // Hand: bind deck select
        html.on('change', '.ce-hand-select-deck', async ev => {
            this._setAfterRenderAnchorFromEvent(ev);
            const handId = ev.currentTarget.dataset.handId;
            const hand = DB.hands.find(h => h.id === handId);
            if (!hand) return;
            hand.srcDeckId = String(ev.currentTarget.value || "");
            await saveDB(); this.render(true);
        });

        // Hand ops
        html.on('click', '.ce-hand-op', async ev => {
            this._setAfterRenderAnchorFromEvent(ev);
            const handId = ev.currentTarget.dataset.handId;
            const op = ev.currentTarget.dataset.op;
            if (!handId || !op) return;
            if (op === 'drawRandom') return this._drawToHand(handId, 1, 'random');
            if (op === 'mulligan')   return this._mulligan(handId, 5);
            if (op === 'dumpAll')    return this._returnAllToLinkedDeck(handId);
        });


            // Hand CRUD (robust to clicks on <i>)
            html.on('click', '.ce-hand-action, .ce-hand-action *', async ev => {
                ev.preventDefault(); ev.stopPropagation();
                const btn = ev.target.closest('.ce-hand-action'); if (!btn) return;
                this._setAfterRenderAnchorFromEvent({ currentTarget: btn });

                const handEl = btn.closest('.ce-hand'); const action = btn.dataset.action;
                const handId = handEl?.dataset.handId; if (!handId || !action) return;
                const hand = DB.hands.find(h => h.id === handId); if (!hand) return;

                                if (action === 'collapse') {
                                        hand.collapsed = !hand.collapsed;
                                        await saveDB();
                                        this.render(true);
                                        return;
                                    }

                if (action === 'rename') {
                    const newName = await Dialog.prompt({
                        title: 'Rename Hand',
                        content: `<form><p>Hand Name:</p><input type="text" name="name" value="${foundry.utils.escapeHTML(hand.name)}"/></form>`,
                                                        label: 'OK',
                                                        callback: (h) => {
                                                            const jq = window.jQuery;
                                                            const $h = jq && h instanceof jq ? h : jq(h);
                                                            const val = $h.find('input[name="name"]').val();
                                                            return (typeof val === 'string' ? val.trim() : '') || hand.name;
                                                        }
                    });
                    if (newName && newName !== hand.name) hand.name = newName;
                }

                if (action === 'clear') {
                    const all = [...(hand.cards ?? []), ...(hand.discard ?? [])];
                    for (const cid of all) if (!DB.cards.find(c => c.id === cid))
                        DB.cards.push({ id: cid, name: DB.index[cid] || `Card ${String(cid).slice(0,4)}` });
                    hand.cards = []; hand.discard = [];
                }

                if (action === 'delete') {
                    const all = [...(hand.cards ?? []), ...(hand.discard ?? [])];
                    for (const cid of all) if (!DB.cards.find(c => c.id === cid))
                        DB.cards.push({ id: cid, name: DB.index[cid] || `Card ${String(cid).slice(0,4)}` });
                    DB.hands = DB.hands.filter(h => h.id !== handId);
                }

                repairDB(); await saveDB(); this.render(true);
            });


            // Booster tiles: click to open, context menu to set/clear image
            html.on('click', '.ce-pack', async ev => {
                ev.preventDefault(); ev.stopPropagation();
                const type = ev.currentTarget?.dataset?.packType;
                if (!type) return;
                await this._openBooster(type);
                await saveDB(); this.render(true);
            });

            if (this._packCtx) this._packCtx.destroy?.();
            this._packCtx = new ContextMenu(html, '.ce-pack', [
                {
                    name: 'Set Image…',
                    icon: '<i class="fas fa-image"></i>',
                    callback: async target => {
                        const el = (target && typeof target === 'object' && 'jquery' in target) ? target[0] : target;
                        const type = el?.dataset?.packType; if (!type) return;
                        const picker = new FilePicker({
                            type: 'image',
                            current: DB.packImages[type] || 'icons/',
                            callback: async (path) => { DB.packImages[type] = path; await saveDB(); this.render(true); }
                        });
                        picker.render(true);
                    }
                },
                {
                    name: 'Clear Image',
                    icon: '<i class="fas fa-ban"></i>',
                    callback: async target => {
                        const el = (target && typeof target === 'object' && 'jquery' in target) ? target[0] : target;
                        const type = el?.dataset?.packType; if (!type) return;
                        delete DB.packImages[type]; await saveDB(); this.render(true);
                    }
                }

            ]);
            // Right-click a booster to set/clear image (native contextmenu)
            html.on('contextmenu', '.ce-pack, .ce-pack *', async ev => {
                ev.preventDefault();
                ev.stopPropagation();
                const el = ev.target.closest('.ce-pack');
                const type = el?.dataset?.packType;
                if (!type) return;

                // Hold Alt while right-clicking to clear quickly
                if (ev.altKey) {
                    delete DB.packImages[type];
                    await saveDB();
                    this.render(true);
                    return;
                }

                const picker = new FilePicker({
                    type: 'image',
                    current: DB.packImages[type] || 'icons/',
                    callback: async (path) => {
                        DB.packImages[type] = path;
                        await saveDB();
                        this.render(true);
                    }
                });
                picker.render(true);
            });


            // Drag sources & targets
            this._bindDraggables(html[0]);
            this._bindDropTargets(html[0]);

            // Card context menu (edit, tags, images, delete)
            this._bindCardContextMenu(html);

            // Controls: search + sort
            const searchEl = html[0].querySelector('#ce-search');
            const sortEl   = html[0].querySelector('#ce-sort');
            const pileEl   = html[0].querySelector('#ce-pile-search');  // NEW
            if (searchEl) searchEl.value = this._search || "";
            if (sortEl)   sortEl.value   = this._sort || "name-asc";

            // Debounced search
            searchEl?.addEventListener('input', (e) => {
                const el = e.target;
                const next = String(el.value || "").trim().toLowerCase();
                        // Skip work if nothing changed
                        if (next === this._search) return;
                        this._search = next;
                        // Remember focus & caret so we can restore after re-render
                        this._searchHadFocus = (document.activeElement === el);
                        try {
                              this._searchSelStart = el.selectionStart;
                              this._searchSelEnd   = el.selectionEnd;
                            } catch (_) {}
                            if (this._searchTimer) clearTimeout(this._searchTimer);
                            this._searchTimer = setTimeout(() => this.render(true), 120);
            });
            sortEl?.addEventListener('change', (e) => { this._sort = String(e.target.value || "name-asc"); this.render(true); });


                    // --- NEW: Debounced piles filter (Decks/Hands names only) ---
                    pileEl?.addEventListener('input', (e) => {
                            const el = e.target;
                            const next = String(el.value || "").trim().toLowerCase();
                            if (next === this._pileSearch) return;
                            this._pileSearch = next;
                            this._pileHadFocus = (document.activeElement === el);
                            try {
                                    this._pileSelStart = el.selectionStart;
                                    this._pileSelEnd   = el.selectionEnd;
                                } catch (_) {}
                                if (this._pileTimer) clearTimeout(this._pileTimer);
                                this._pileTimer = setTimeout(() => this.render(true), 120);
                            });

            // Tooltip portal
            this._installTooltipPortal();
            this._bindPortalTooltips();
            this._dedupeDOM(html[0]);

            // Restore anchored scroll
            this._scrollToAnchor();


                  // --- NEW: restore search focus & caret after re-render ---
                  if (this._searchHadFocus && searchEl) {
                        // Defer one tick to ensure the element is attached & layout is stable
                        setTimeout(() => {
                              try {
                                    searchEl.focus();
                                    const start = Number.isInteger(this._searchSelStart) ? this._searchSelStart : searchEl.value.length;
                                    const end   = Number.isInteger(this._searchSelEnd)   ? this._searchSelEnd   : start;
                                    searchEl.setSelectionRange(start, end);
                                  } catch (_) { /* no-op */ }
                                  this._searchHadFocus = false;
                                }, 0);
                      }

                              // --- NEW: restore pile filter caret/focus too ---
                              if (this._pileHadFocus && pileEl) {
                                      setTimeout(() => {
                                              try {
                                                      pileEl.focus();
                                                      const start = Number.isInteger(this._pileSelStart) ? this._pileSelStart : pileEl.value.length;
                                                      const end   = Number.isInteger(this._pileSelEnd)   ? this._pileSelEnd   : start;
                                                      pileEl.setSelectionRange(start, end);
                                                  } catch (_) { /* no-op */ }
                                                  this._pileHadFocus = false;
                                              }, 0);
                                  }

    }

    _bindDraggables(root) {
        const cards = root.querySelectorAll('.ce-card');
        cards.forEach(card => {
            card.setAttribute('draggable', 'true');
            card.querySelectorAll('*').forEach(child => child.setAttribute('draggable', 'false'));
            card.addEventListener('dragstart', ev => {
                const payload = {
                    type: 'ce-card',
                    cardId: card.dataset.cardId,
                    from: card.closest('[data-source]')?.dataset.source || 'pool'
                };
                try { ev.dataTransfer.setData('text/plain', JSON.stringify(payload)); } catch (_) {}
                ev.dataTransfer.effectAllowed = 'move';
            });
        });

        // Fallback delegation
        root.addEventListener('dragstart', ev => {
            const card = ev.target?.closest?.('.ce-card');
            if (!card || !ev.dataTransfer) return;
            const hasText = (() => { try { return Array.from(ev.dataTransfer.types || []).includes('text/plain'); } catch { return false; }})();
            if (!hasText) {
                const payload = {
                    type: 'ce-card',
                    cardId: card.dataset.cardId,
                    from: card.closest('[data-source]')?.dataset.source || 'pool'
                };
                try { ev.dataTransfer.setData('text/plain', JSON.stringify(payload)); } catch (_) {}
                ev.dataTransfer.effectAllowed = 'move';
            }
        }, true);
        // Make cards that occupy slots draggable (source = hand-slot:<handId>:<slotIdx>)
        const slotCards = root.querySelectorAll('.ce-slot .ce-slot-card');
        slotCards.forEach(node => {
            node.setAttribute('draggable', 'true');
            node.querySelectorAll('*').forEach(child => child.setAttribute('draggable', 'false'));
            node.addEventListener('dragstart', ev => {
                const slotEl = node.closest('.ce-slot');
                const handId = slotEl?.dataset?.handId || "";
                const slotIdx = slotEl?.dataset?.slotIdx ?? "";
                const cid = node.dataset.cardId;   // requires data-card-id="{{this.card.id}}" on .ce-slot-card

                if (!cid) return;
                const payload = { type: 'ce-card', cardId: cid, from: `hand-slot:${handId}:${slotIdx}` };
                try { ev.dataTransfer.setData('text/plain', JSON.stringify(payload)); } catch (_) {}
                ev.dataTransfer.effectAllowed = 'move';
            });
        });
    }

    _bindDropTargets(root) {
        const makeDroppable = (el, acceptsDrops = true) => {
            el.addEventListener('dragover', ev => {
                if (!acceptsDrops) return;
                ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; el.classList.add('dragover');
            });
            el.addEventListener('dragleave', () => el.classList.remove('dragover'));
            el.addEventListener('drop', async ev => {
                el.classList.remove('dragover');
                if (!acceptsDrops) return;
                ev.preventDefault();
                let data; try { data = JSON.parse(ev.dataTransfer.getData('text/plain')); } catch(_) {}
                if (!data || data.type !== 'ce-card') return;

                // Anchor to the container we dropped into
                this._setAfterRenderAnchorFromElement(el);

                await this._moveCard(data.cardId, data.from, el);
            });
        };

        // Pool accepts drops
        const pool = root.querySelector('#ce-pool');
        if (pool) makeDroppable(pool, true);

        // Deck bodies accept drops
        root.querySelectorAll('.ce-deck-body').forEach(body => makeDroppable(body, true));

        // Hand bodies accept drops
        root.querySelectorAll('.ce-hand-body').forEach(body => makeDroppable(body, true));

        // Per-hand discard bodies accept drops
        root.querySelectorAll('.ce-hand-discard-body').forEach(body => makeDroppable(body, true));

        // Slot targets (10 per hand)
        root.querySelectorAll('.ce-hand-slots .ce-slot').forEach(slot => {
            slot.addEventListener('dragover', ev => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; slot.classList.add('dragover'); });
            slot.addEventListener('dragleave', () => slot.classList.remove('dragover'));
            slot.addEventListener('drop', async ev => {
                slot.classList.remove('dragover');
                let data; try { data = JSON.parse(ev.dataTransfer.getData('text/plain')); } catch(_) {}
                if (!data || data.type !== 'ce-card') return;

                // anchor scroll to the owning hand
                this._setAfterRenderAnchorFromElement(slot);

                const toHandId = slot.dataset.handId;
                const idx = Number(slot.dataset.slotIdx ?? -1);
                if (!toHandId || idx < 0 || idx > 9) return;

                await this._moveCardToSlot(data.cardId, data.from, toHandId, idx);
            });
        });


        // Master does not accept drops
        const master = root.querySelector('#ce-master');
        if (master) makeDroppable(master, false);

        // Booster column is not droppable (click only) — no binding required
    }

    _bindCardContextMenu(html) {
        if (this._ctx) this._ctx.destroy?.();
        const getEl = (arg) => (arg && typeof arg === 'object' && 'jquery' in arg) ? arg[0] : arg ?? null;

        const editCard = async (cardId) => {
            const name   = DB.index[cardId] || `Card ${String(cardId).slice(0,4)}`;
            const type   = DB.meta[cardId]?.type   ?? "";
            const rarity = DB.meta[cardId]?.rarity ?? "Common";
            const rules  = DB.meta[cardId]?.rules  ?? "";

            const rarityOptions = ["Common","Uncommon","Rare","Set","Legendary","Unique"]
            .map(r => `<option value="${r}" ${r===rarity?'selected':''}>${r}</option>`).join("");

            const content = `
            <form class="card-sheet" style="display:grid; gap:8px;">
            <div>
            <label>Name</label>
            <input type="text" name="name" value="${foundry.utils.escapeHTML(name)}"/>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
            <div>
            <label>Type</label>
            <input type="text" name="type" value="${foundry.utils.escapeHTML(type)}"/>
            </div>
            <div>
            <label>Rarity</label>
            <select name="rarity">${rarityOptions}</select>
            </div>
            </div>
            <div>
            <label>Rules Text</label>
            <textarea class="editor" name="rules" rows="6"></textarea>
            <p class="notes">
            Rich text supports inline rolls <code>[[1d20+5]]</code> and entity links:
            <code>@Actor[id]{Name}</code>, <code>@Item[id]{Name}</code>, or drag &amp; drop from the sidebar.
            </p>
            </div>
            </form>
            `;

            const isHTML = (s) => /<\/?[a-z][\s\S]*>/i.test(s);
            let editorReady = null, editorRef = null;

            const dlg = new Dialog({
                title: "Edit Card",
                content,
                render: (html) => {
                    const $ = (window.jQuery && html instanceof jQuery) ? html : $(html);
                    const ta = $.find('textarea[name="rules"]')[0];
                    const initial = isHTML(rules) ? rules : foundry.utils.escapeHTML(rules || "");
                    editorReady = Promise.resolve(
                        TextEditor.create({
  target: ta,
  engine: "tinymce",
  height: 320,
  plugins: "lists table link image hr code",
  toolbar: "styleselect | bold italic underline strikethrough | forecolor backcolor | removeformat | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | table | link image | hr | code",
  menubar: false,
  statusbar: false,
  branding: false
}, initial)
                    ).then(ed => { editorRef = ed; return ed; });
                },
                buttons: {
                    cancel: { label: "Cancel" },
                    save: {
                        label: "Save",
                        icon: '<i class="fas fa-save"></i>',
                        callback: async (html) => {
                            const $ = (window.jQuery && html instanceof jQuery) ? html : $(html);
                            const nameVal   = String($.find('input[name="name"]').val() ?? "").trim();
                            const typeVal   = String($.find('input[name="type"]').val() ?? "").trim();
                            const rarityVal = String($.find('select[name="rarity"]').val() ?? "Common");
                            const ta = $.find('textarea[name="rules"]')[0];

                            if (editorReady?.then) await editorReady;
                            try { await editorRef?.save(); } catch (_) {}

                            const rulesHTML = ta?.value ?? "";

                            if (nameVal && nameVal !== DB.index[cardId]) {
                                DB.index[cardId] = nameVal;
                                const p = DB.cards.find(c => c.id === cardId); if (p) p.name = nameVal;
                                const m = DB.master.find(c => c.id === cardId); if (m) m.name = nameVal;
                            }
                            const prev = DB.meta[cardId] || {};
                            DB.meta[cardId] = { type: typeVal, rarity: rarityVal, rules: rulesHTML, tags: prev.tags || [] };

                            repairDB(); await saveDB(); this.render(true);
                        }
                    }
                },
                default: "save"
            });
            dlg.render(true);
        };

        const editTags = async (cardId) => {
            const current = (DB.meta[cardId]?.tags ?? []).join(', ');
            const html = `
            <form>
            <p>Enter comma-separated tags (example: <code>draw, healing, AoE</code>)</p>
            <input type="text" name="tags" value="${foundry.utils.escapeHTML(current)}" />
            </form>
            `;
            const tags = await Dialog.prompt({
                title: 'Edit Tags',
                content: html,
                label: 'Save',
                callback: (h) => {
                    const jq = window.jQuery;
                    const $h = jq && h instanceof jq ? h : jq(h);
                    const raw = String($h.find('input[name="tags"]').val() ?? "");
                    return raw.split(',').map(t => t.trim()).filter(Boolean);
                }
            });
            if (tags) {
                const prev = DB.meta[cardId] || { type:"", rarity:"Common", rules:"", tags:[] };
                DB.meta[cardId] = { ...prev, tags };
                await saveDB(); this.render(true);
            }
        };

        this._ctx = new ContextMenu(html, '.ce-card', [
            { name: 'Edit Card…',  icon: '<i class="fas fa-pen"></i>',    callback: async target => {
                const el = (target && typeof target === 'object' && 'jquery' in target) ? target[0] : target;
                const root = el?.closest?.('.ce-card') ?? el; const cardId = root?.dataset?.cardId;
                if (!cardId) return ui.notifications?.warn('No card id on target.'); await editCard(cardId);
            } },
            { name: 'Edit Tags…',  icon: '<i class="fas fa-tags"></i>',   callback: async target => {
                const el = (target && typeof target === 'object' && 'jquery' in target) ? target[0] : target;
                const root = el?.closest?.('.ce-card') ?? el; const cardId = root?.dataset?.cardId;
                if (!cardId) return ui.notifications?.warn('No card id on target.'); await editTags(cardId);
            } },
            { name: 'Set Image…',  icon: '<i class="fas fa-image"></i>',  callback: async target => {
                const el = (target && typeof target === 'object' && 'jquery' in target) ? target[0] : target;
                const root = el?.closest?.('.ce-card') ?? el; const cardId = root?.dataset?.cardId;
                if (!cardId) return ui.notifications?.warn('No card id on target.');
                const picker = new FilePicker({ type: 'image', current: DB.images[cardId] || 'icons/',
                    callback: async (path) => { DB.images[cardId] = path; await saveDB(); this.render(true); } });
                picker.render(true);
            } },
            { name: 'Clear Image', icon: '<i class="fas fa-ban"></i>',    callback: async target => {
                const el = (target && typeof target === 'object' && 'jquery' in target) ? target[0] : target;
                const root = el?.closest?.('.ce-card') ?? el; const cardId = root?.dataset?.cardId;
                if (!cardId) return; delete DB.images[cardId]; await saveDB(); this.render(true);
            } },
            { name: 'Delete Card…', icon: '<i class="fas fa-trash"></i>', callback: async target => {
                const el = (target && typeof target === 'object' && 'jquery' in target) ? target[0] : target;
                const root = el?.closest?.('.ce-card') ?? el; const cardId = root?.dataset?.cardId;
                if (!cardId) return ui.notifications?.warn('No card id on target.');
                const name = DB.index[cardId] || `Card ${String(cardId).slice(0,4)}`;
                const confirmed = await Dialog.confirm({
                    title: 'Delete Card',
                    content: `<p><strong>Delete “${foundry.utils.escapeHTML(name)}”?</strong></p>
                    <p>This will permanently remove the card from the Master DB (if present), the pool and all piles. This cannot be undone.</p>`,
                                                       yes: () => true, no: () => false, defaultYes: false
                });
                if (!confirmed) return;
                DB.master = DB.master.filter(c => c.id !== cardId);
                DB.cards  = DB.cards.filter(c => c.id !== cardId);
                DB.decks.forEach(d => d.cards = d.cards.filter(cid => cid !== cardId));
                DB.hands.forEach(h => { h.cards = (h.cards ?? []).filter(cid => cid !== cardId); h.discard = (h.discard ?? []).filter(cid => cid !== cardId); });
                delete DB.index[cardId]; delete DB.images[cardId]; delete DB.meta[cardId];
                repairDB(); await saveDB(); this.render(true);
            } }
        ]);
    }

    async _moveCard(cardId, fromSource, dropEl) {
        const deckEl   = dropEl.closest('.ce-deck-body');
        const toDeckId = deckEl ? deckEl.closest('.ce-deck')?.dataset.deckId : null;

        const handEl   = dropEl.closest('.ce-hand-body');
        const toHandId = handEl ? handEl.closest('.ce-hand')?.dataset.handId : null;

        const handDiscardEl   = dropEl.closest?.('.ce-hand-discard-body');
        const toHandDiscardId = handDiscardEl ? handDiscardEl.closest('.ce-hand')?.dataset.handId : null;

        // If dropping into Master: ignore
        const intoMaster = dropEl.closest?.('#ce-master');
        if (intoMaster) return;

        const moveListPushOnce = async (list, cid) => {
            if (!list.find(c => (typeof c === 'object' ? c.id : c) === cid)) {
                list.push({ id: cid, name: DB.index[cid] || `Card ${String(cid).slice(0,4)}` });
            }
        };

        // Copy from Master → target
        if (fromSource === 'master') {
            const newId = uid();
            const name = DB.index[cardId] || `Card ${String(cardId).slice(0,4)}`;
            DB.index[newId]  = name;
            DB.images[newId] = DB.images[cardId] || null;
            DB.meta[newId]   = JSON.parse(JSON.stringify(DB.meta[cardId] || { type:"", rarity:"Common", rules:"", tags:[] }));

            if (toDeckId) {
                const deck = DB.decks.find(d => d.id === toDeckId);
                if (deck && !deck.cards.includes(newId)) deck.cards.push(newId);
            } else if (toHandId) {
                const hand = DB.hands.find(h => h.id === toHandId);
                if (hand) { hand.cards = hand.cards || []; if (!hand.cards.includes(newId)) hand.cards.push(newId); }
            } else if (toHandDiscardId) {
                const hand = DB.hands.find(h => h.id === toHandDiscardId);
                if (hand) { hand.discard = hand.discard || []; if (!hand.discard.includes(newId)) hand.discard.push(newId); }
            } else {
                await moveListPushOnce(DB.cards, newId);
            }

            await saveDB(); this.render(true); return;
        }

        // Normal move
        DB.cards    = DB.cards.filter(c => c.id !== cardId);
        DB.decks.forEach(d => d.cards = d.cards.filter(cid => cid !== cardId));
        DB.hands.forEach(h => {
            h.cards   = (h.cards   ?? []).filter(cid => cid !== cardId);
            h.discard = (h.discard ?? []).filter(cid => cid !== cardId);
        });
        // If dragging from a specific hand slot, clear it before normal move
        if (typeof fromSource === 'string' && fromSource.startsWith('hand-slot:')) {
            const [, handId, idxStr] = fromSource.split(':');
            const idx = Number(idxStr);
            const hand = DB.hands.find(h => h.id === handId);
            if (hand && idx >= 0 && idx < 10) {
                if (!Array.isArray(hand.slots)) hand.slots = Array(10).fill("");
                if (hand.slots[idx] === cardId) hand.slots[idx] = "";
            }
        }

        if (toDeckId) {
            const deck = DB.decks.find(d => d.id === toDeckId);
            if (deck && !deck.cards.includes(cardId)) deck.cards.push(cardId);
        } else if (toHandId) {
            const hand = DB.hands.find(h => h.id === toHandId);
            if (hand) { hand.cards = hand.cards || []; if (!hand.cards.includes(cardId)) hand.cards.push(cardId); }
        } else if (toHandDiscardId) {
            const hand = DB.hands.find(h => h.id === toHandDiscardId);
            if (hand) { hand.discard = hand.discard || []; if (!hand.discard.includes(cardId)) hand.discard.push(cardId); }
        } else {
            await moveListPushOnce(DB.cards, cardId);
        }

        repairDB(); await saveDB(); this.render(true);
    }
    async _moveCardToSlot(cardId, fromSource, handId, slotIdx) {
        const hand = DB.hands.find(h => h.id === handId);
        if (!hand) return;

        // Master copies become new instances
        if (fromSource === 'master') {
            const newId = uid();
            const name = DB.index[cardId] || `Card ${String(cardId).slice(0,4)}`;
            DB.index[newId]  = name;
            DB.images[newId] = DB.images[cardId] || null;
            DB.meta[newId]   = JSON.parse(JSON.stringify(DB.meta[cardId] || { type:"", rarity:"Common", rules:"", tags:[] }));
            // place into slot
            hand.slots = hand.slots || Array(10).fill("");
            hand.slots[slotIdx] = newId;
            await saveDB(); this.render(true);
            return;
        }

        // Remove card from wherever it lives now
        DB.cards = DB.cards.filter(c => c.id !== cardId);
        DB.decks.forEach(d => d.cards = d.cards.filter(cid => cid !== cardId));
        DB.hands.forEach(h => {
            h.cards   = (h.cards   ?? []).filter(cid => cid !== cardId);
            h.discard = (h.discard ?? []).filter(cid => cid !== cardId);
            if (Array.isArray(h.slots)) h.slots = h.slots.map(cid => cid === cardId ? "" : cid);
        });

            // Place into target slot
            hand.slots = hand.slots || Array(10).fill("");
            hand.slots[slotIdx] = cardId;

            repairDB(); await saveDB(); this.render(true);
    }


    /* ---------------- Tooltip Portal (hoverable) ---------------- */
    _installTooltipPortal() {
        // If our stored element was removed by a previous close(), drop the stale reference
        if (this._tooltipEl && !document.body.contains(this._tooltipEl)) {
            try { this._tooltipEl.remove(); } catch (_) {}
            this._tooltipEl = null;
        }

        // Create or reuse #ce-tooltip
        let el = document.getElementById('ce-tooltip');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ce-tooltip';
            el.style.display = 'none';
            document.body.appendChild(el);
        }
        this._tooltipEl = el;

        // Let users move into the tooltip without it vanishing
        this._tooltipEl.onmouseenter = () => { clearTimeout(this._ttHideTimer); };
        this._tooltipEl.onmouseleave = () => { this._scheduleTooltipHide?.(); };
    }

    _bindPortalTooltips() {
        const root   = this.element?.[0];           // app root
        const portal = this._tooltipEl;
        if (!root || !portal) return;

        // Linger delay after leaving card/tooltip (prevents flicker)
        this._ttHideDelay = 100;
        this._scheduleTooltipHide = () => {
            clearTimeout(this._ttHideTimer);
            this._ttHideTimer = setTimeout(() => { portal.style.display = 'none'; }, this._ttHideDelay);
        };
        const CARD_SELECTOR = '[data-card-id]';

        const getCardHTML = (cardId) => {
            // Prefer enriched rules from getData(); fall back to the canonical name from module-scoped DB
            const html = this._rulesHTML?.[cardId];
            if (html && String(html).trim()) return html;
            const name = (DB.index?.[cardId]) || '';
            return foundry.utils.escapeHTML(name);
        };

        const positionByCard = (cardEl) => {
            // Measure the tooltip to place it relative to the card and clamp to viewport
            const pad = 8, vw = window.innerWidth, vh = window.innerHeight;
            const cardRect = cardEl.getBoundingClientRect();

            // Ensure measurement baseline
            portal.style.left = '0px';
            portal.style.top  = '0px';
            const tipRect = portal.getBoundingClientRect();

            // Try above, centered; if no space, place below
            let x = cardRect.left + (cardRect.width - tipRect.width) / 2;
            let y = cardRect.top - tipRect.height - pad;
            if (y < pad) y = cardRect.bottom + pad;

            // Clamp horizontally & vertically
            if (x < pad) x = pad;
            if (x + tipRect.width + pad > vw) x = Math.max(pad, vw - tipRect.width - pad);
            if (y + tipRect.height + pad > vh) y = Math.max(pad, vh - tipRect.height - pad);

            portal.style.left = `${x}px`;
            portal.style.top  = `${y}px`;
        };

        const showTooltip = (cardEl) => {
            clearTimeout(this._ttHideTimer);
            if (!cardEl) return;
            const cardId = cardEl.dataset.cardId;
            const html = getCardHTML(cardId);
            portal.innerHTML = html || '&nbsp;';   // ensure non-zero height
            portal.style.display = 'block';
            positionByCard(cardEl);                // << pinned to the card, not the mouse
        };

        // Clean old handlers (if app re-rendered)
        if (this._ttDelegatedOnOver) root.removeEventListener('mouseover', this._ttDelegatedOnOver, true);
        if (this._ttDelegatedOnOut)  root.removeEventListener('mouseout',  this._ttDelegatedOnOut,  true);

        // Delegated handlers on the app root
        this._ttDelegatedOnOver = (e) => {
            const card = e.target?.closest?.(CARD_SELECTOR);
            if (!card || !root.contains(card)) return;
            showTooltip(card);
        };

          this._ttDelegatedOnOut = (e) => {
                const fromCard = e.target?.closest?.(CARD_SELECTOR);
                const toNode   = e.relatedTarget;
                const toCard   = toNode?.closest?.(CARD_SELECTOR);
                // If moving into the tooltip itself or directly to another card, don't hide yet.
                if (fromCard && (portal.contains(toNode) || toCard)) return;
                if (fromCard) this._scheduleTooltipHide();
              };

            root.addEventListener('mouseover', this._ttDelegatedOnOver, true);
            root.addEventListener('mouseout',  this._ttDelegatedOnOut,  true);
    }




    _showPortalTooltipFromCard(card) {
        const tip = (this._tooltipEl = document.getElementById('ce-tooltip'));
        if (!tip) return;

        const getId = (el) =>
        el?.dataset?.cardId ||
        el?.closest?.('[data-card-id]')?.dataset?.cardId || '';

        const id = getId(card);
        const html = (this._rulesHTML && id) ? this._rulesHTML[id] : "";

        tip.style.display = 'block';
        tip.innerHTML = html || "<em>No rules text.</em>";
        this._anchorCard = card;
        this._positionPortalTooltip(card);
    }

    _hidePortalTooltip() {
        const tip = (this._tooltipEl = document.getElementById('ce-tooltip'));
        if (!tip) return;
        tip.style.display = 'none';
        tip.innerHTML = '';
        this._anchorCard = null;
    }
    _scheduleHidePortalTooltip(delay = 400) {
        this._cancelHidePortalTooltip();
        this._hideTimer = setTimeout(() => {
            // Only hide if pointer isn’t over a card AND not over the tooltip
            if (!this._overCard && !this._tooltipHover) this._hidePortalTooltip();
        }, delay);
    }

    _cancelHidePortalTooltip() {
        if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
    }

    _positionPortalTooltip(card) {
        const tip = (this._tooltipEl = document.getElementById('ce-tooltip')); if (!tip || !card) return;
        const r = card.getBoundingClientRect();
        tip.style.left = '0px'; tip.style.top  = '-1000px';
        const w = tip.offsetWidth, h = tip.offsetHeight;
        let left = Math.round(r.left + r.width / 2 - w / 2);
        let top  = Math.round(r.top - h - 10);
        const pad = 8;
        const vw = Math.max(document.documentElement.clientWidth,  window.innerWidth  || 0);
        const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
        left = Math.max(pad, Math.min(left, vw - w - pad));
        if (top < pad) top = Math.round(r.bottom + 10);
        if (top + h > vh - pad) top = Math.max(pad, Math.min(top, vh - h - pad));
        tip.style.left = `${left}px`;
        tip.style.top  = `${top}px`;
    }

    /* Remove duplicate DOM nodes with the same data-card-id per container */
    _dedupeDOM(root) {
        const containers = [ ...root.querySelectorAll('#ce-master, #ce-pool, .ce-deck-body, .ce-hand-body, .ce-hand-discard-body') ];
        for (const cont of containers) {
            const seen = new Set();
            const cards = [...cont.querySelectorAll('.ce-card')];
            for (const el of cards) {
                const id = el.dataset.cardId;
                if (!id) continue;
                if (seen.has(id)) el.remove();
                else seen.add(id);
            }
        }
    }

    /* ---------------- Hand operations ---------------- */
    async _drawToHand(handId, count=1, mode='top') {
        const hand = DB.hands.find(h => h.id === handId);
        const deck = DB.decks.find(d => d.id === hand?.srcDeckId);
        if (!hand || !deck) return ui?.notifications?.warn('Select a Deck for this Hand first.');
        hand.cards = hand.cards || [];
        for (let i = 0; i < count; i++) {
            if (!deck.cards.length) break;
            let idx = 0;
            if (mode === 'top') idx = deck.cards.length - 1;
            else if (mode === 'bottom') idx = 0;
            else if (mode === 'random') idx = Math.floor(Math.random() * deck.cards.length);
            const cid = deck.cards.splice(idx, 1)[0];
            if (!hand.cards.includes(cid)) hand.cards.push(cid);
        }
        repairDB(); await saveDB(); this.render(true);
    }

    async _mulligan(handId, drawCount = 5) {
        const hand = DB.hands.find(h => h.id === handId);
        const deck = DB.decks.find(d => d.id === hand?.srcDeckId);
        if (!hand || !deck) return ui?.notifications?.warn('Select a Deck for this Hand first.');

        // 1) Return all hand cards to the deck (append)
        const returning = [...(hand.cards ?? [])];
        hand.cards = [];
        deck.cards.push(...returning);

        // 2) Draw N random cards
        for (let i = 0; i < drawCount; i++) {
            if (!deck.cards.length) break;
            const idx = Math.floor(Math.random() * deck.cards.length);
            const cid = deck.cards.splice(idx, 1)[0];
            hand.cards.push(cid);
        }

        repairDB(); await saveDB(); this.render(true);
    }

    /* ---------------- Booster logic ---------------- */
    _rollPackTier() {
        // returns an array of rarity strings needed (e.g., ["Common","Common","Common","Common","Uncommon","Uncommon","Rare", ...])
        const base = ["Common","Common","Common","Common","Uncommon","Uncommon","Rare"]; // 7
        const set  = [...base, "Set"];             // 8
        const leg  = [...set, "Legendary"];        // 9
        const uni  = [...leg, "Unique"];           // 10
        const r = Math.random();
        if (r < 0.65) return base;
        if (r < 0.80) return set;
        if (r < 0.95) return leg;
        return uni;
    }

    _collectCandidatesForPack(packKey) {
        const def = PACK_TYPES.find(p => p.key === packKey);
        if (!def) return [];
        const lowerTag = def.tag ? String(def.tag).toLowerCase() : null;

        // Universal = all master; others = tag match (case-insensitive)
        const ids = DB.master
        .map(c => c.id)
        .filter(id => {
            if (!def.tag) return true;
            const tags = (DB.meta[id]?.tags ?? []).map(t => String(t).toLowerCase());
            return tags.includes(lowerTag);
        });
        return ids;
    }

    _randPick(arr) { return arr.length ? arr[Math.floor(Math.random()*arr.length)] : undefined; }

    async _openBooster(packKey) {
        const candidates = this._collectCandidatesForPack(packKey);
        if (!candidates.length) {
            ui?.notifications?.warn(`No Master cards found for ${packKey} pack.`);
            return;
        }

        // Build rarity buckets
        const buckets = {
            "Common": [], "Uncommon": [], "Rare": [], "Set": [], "Legendary": [], "Unique": []
        };
        for (const id of candidates) {
            const r = DB.meta[id]?.rarity || "Common";
            if (!buckets[r]) buckets[r] = [];
            buckets[r].push(id);
        }

        // Desired rarities by tier
        const want = this._rollPackTier(); // 7-10 rarities
        const chosen = [];
        const used = new Set();

        const pickFromBucket = (r) => {
            const pool = (buckets[r] || []).filter(id => !used.has(id));
            if (!pool.length) return null;
            const id = this._randPick(pool);
            used.add(id);
            return id;
        };

        // First pass: try to satisfy requested rarities
        for (const rarity of want) {
            const pick = pickFromBucket(rarity);
            if (pick) { chosen.push(pick); continue; }
            // fallback later
            chosen.push(null);
        }

        // Second pass: fill any nulls from any available candidate not yet used
        const anyPool = candidates.filter(id => !used.has(id));
        for (let i = 0; i < chosen.length; i++) {
            if (chosen[i]) continue;
            if (!anyPool.length) break;
            const id = anyPool.splice(Math.floor(Math.random()*anyPool.length), 1)[0];
            used.add(id);
            chosen[i] = id;
        }

        // If still missing, warn
        if (chosen.some(x => !x)) {
            ui?.notifications?.warn(`Insufficient ${packKey} cards at requested rarities; filled with available cards.`);
        }

        // Clone chosen master IDs into pool
        for (const masterId of chosen.filter(Boolean)) {
            const newId = uid();
            const name = DB.index[masterId] || `Card ${String(masterId).slice(0,4)}`;
            DB.index[newId]  = name;
            DB.images[newId] = DB.images[masterId] || null;
            DB.meta[newId]   = JSON.parse(JSON.stringify(DB.meta[masterId] || { type:"", rarity:"Common", rules:"", tags:[] }));
            // add to Pool (avoid duplicate object entries)
            if (!DB.cards.find(c => c.id === newId)) DB.cards.push({ id: newId, name });
        }

        ui?.notifications?.info(`${packKey} Booster opened: ${chosen.filter(Boolean).length} card(s) added to Pool.`);
    }

    async close(options) {
        clearTimeout(this._ttHideTimer);
        // leave #ce-tooltip in the DOM; it’s shared and re-used
        return super.close(options);
    }

    /**
     * Return a single card to the hand's linked deck (top of deck).
     * Works for cards in hand, slots, or discard. No save/render here;
     * callers decide when to persist.
     */
    async _returnCardToLinkedDeck(handId, cardId, { silent = false } = {}) {
        const hand = DB.hands.find(h => h.id === handId);
        if (!hand) return;

        const deckId = hand.srcDeckId;
        if (!deckId) { if (!silent) ui.notifications?.warn("No linked deck selected for this hand."); return; }
        const deck = DB.decks.find(d => d.id === deckId);
        if (!deck)   { if (!silent) ui.notifications?.warn("Linked deck not found."); return; }

        // Remove from everywhere
        DB.cards = DB.cards.filter(c => c.id !== cardId);
        DB.decks.forEach(d => d.cards = (d.cards || []).filter(cid => cid !== cardId));
        DB.hands.forEach(h => {
            h.cards   = (h.cards   ?? []).filter(cid => cid !== cardId);
            h.discard = (h.discard ?? []).filter(cid => cid !== cardId);
            if (Array.isArray(h.slots)) h.slots = h.slots.map(cid => cid === cardId ? "" : cid);
        });

            // Add to top of the linked deck (avoid dup)
            deck.cards = deck.cards || [];
            deck.cards = [cardId, ...deck.cards.filter(cid => cid !== cardId)];
    }

    /**
     * Return every card in a hand (hand, slots, discard) to its linked deck.
     * This one DOES save & re-render for convenience.
     */
    async _returnAllToLinkedDeck(handId) {
        const hand = DB.hands.find(h => h.id === handId);
        if (!hand) return;

        if (!hand.srcDeckId) { ui.notifications?.warn("No linked deck selected for this hand."); return; }

        const inSlots = (hand.slots || []).filter(Boolean);
        const all     = new Set([...(hand.cards || []), ...(hand.discard || []), ...inSlots]);

        for (const cid of all) {
            await this._returnCardToLinkedDeck(handId, cid, { silent: true });
        }

        repairDB(); await saveDB(); this.render(true);
    }



}

/* ------------------------------ READY ------------------------------ */
Hooks.once('ready', async () => {
    console.log(`${MOD} | Master DB + Pool + Piles (Decks/Hands) + per-hand Discard + Boosters + search/tags + tooltip portal`);
    await loadDB();
    repairDB();
    const app = new CardEngineApp();
    app.render(true);
    window.CardEngineApp = CardEngineApp;

    // Convenience macro
    const macroName = 'Card Engine';
    const command = 'new (window.CardEngineApp || Application)().render(true);';
    (async () => {
        try {
            let macro = game.macros?.find(m => m.name === macroName);
            if (!macro) {
                macro = await Macro.create(
                    { name: macroName, type: 'script', scope: 'global', command, img: 'icons/svg/upgrade.svg' },
                    { displaySheet: false }
                );
            }
            if (!game.user.getHotbarMacro(1)) await game.user.assignHotbarMacro(macro, 1);
        } catch (e) { console.error(`${MOD} | macro create/assign failed`, e); }
    })();
});
