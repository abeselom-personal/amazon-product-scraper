// Amazon Product Discovery Engine - Frontend
const API = '/api/pipeline';

const state = {
    view: 'search',
    mode: 'keyword',         // 'keyword' | 'category'
    topLimit: 100,
    pageSize: 20,
    page: 1,
    categoryFilterMode: 'ai', // 'ai' | 'scrape'
    category: '',            // results filter
    products: [],
    runs: [],
    config: null,
    categories: [],
    skipAI: false,           // skip AI enrichment for faster large-scale scraping
    selectedProductIds: new Set(), // selected products for owner selection
};

// ---------- Utilities ----------
const $ = (sel) => document.querySelector(sel);
const $all = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg, type = 'info', ms = 3500) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function fmtMoney(n) {
    if (n == null || isNaN(n)) return '—';
    return `£${Number(n).toFixed(2)}`;
}
function fmtScore(n) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(3);
}
function scoreClass(s) {
    if (s == null) return '';
    if (s >= 0.7) return 'score-high';
    if (s >= 0.5) return 'score-mid';
    return 'score-low';
}
function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function toAiCategoryValue(name) {
    const valueMap = {
        Hardware: 'hardware',
        Electronics: 'electronics',
        Tools: 'tools',
        Office: 'office_supplies',
        Misc: 'misc',
    };
    return valueMap[name] || String(name || '').toLowerCase();
}

function populateCategoryFilterOptions() {
    const filterSel = $('#category-filter');
    if (!filterSel) return;

    const options = (state.categories || []).map((c) => {
        const label = c.name;
        const value = state.categoryFilterMode === 'scrape' ? label : toAiCategoryValue(label);
        return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    }).join('');

    filterSel.innerHTML = '<option value="">All categories</option>' + options;
    state.category = '';
    filterSel.value = '';
}

async function api(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.details || err.error || `Request failed: ${res.status}`);
    }
    return res.json();
}

// ---------- View routing ----------
function setView(view) {
    state.view = view;
    $all('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $all('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    if (view === 'results') loadTopProducts();
    if (view === 'runs') loadRuns();
}
$all('.nav-btn').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));

// ---------- Mode toggle (keyword <-> category) ----------
$all('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        state.mode = btn.dataset.mode;
        $all('.mode-btn').forEach(b => b.classList.toggle('active', b === btn));
        $('#field-keyword').classList.toggle('hidden', state.mode !== 'keyword');
        $('#field-category').classList.toggle('hidden', state.mode !== 'category');
        const kw = $('#keyword-input');
        kw.required = state.mode === 'keyword';
    });
});

// ---------- Skip AI toggle ----------
$('#skip-ai-checkbox')?.addEventListener('change', e => {
    state.skipAI = e.target.checked;
});

// ---------- Product selection ----------
document.addEventListener('change', e => {
    if (e.target.classList.contains('product-checkbox')) {
        const productId = e.target.dataset.id;
        if (e.target.checked) {
            state.selectedProductIds.add(productId);
        } else {
            state.selectedProductIds.delete(productId);
        }
        updateSelectionUI();
    }
});

$('#select-all')?.addEventListener('click', () => {
    document.querySelectorAll('.product-checkbox').forEach(cb => {
        cb.checked = true;
        state.selectedProductIds.add(cb.dataset.id);
    });
    updateSelectionUI();
});

$('#deselect-all')?.addEventListener('click', () => {
    document.querySelectorAll('.product-checkbox').forEach(cb => {
        cb.checked = false;
        state.selectedProductIds.delete(cb.dataset.id);
    });
    updateSelectionUI();
});

$('#export-selected')?.addEventListener('click', async () => {
    const selected = getSelectedProducts();
    if (selected.length === 0) {
        toast('No products selected', 'error');
        return;
    }
    toast(`Exporting ${selected.length} selected products...`, 'info');
    // TODO: Implement export functionality
});

function updateSelectionUI() {
    const count = state.selectedProductIds.size;
    const selectionBar = $('#selection-bar');
    if (count > 0) {
        selectionBar.classList.remove('hidden');
        selectionBar.querySelector('.selection-count').textContent = `${count} selected`;
    } else {
        selectionBar.classList.add('hidden');
    }
}

function getSelectedProducts() {
    return state.products.filter(p => state.selectedProductIds.has(String(p.id)));
}

async function loadRuns() {
    try {
        const data = await api('/runs?limit=20');
        state.runs = data.runs || [];
        const list = $('#runs-list');

        if (!state.runs.length) {
            list.innerHTML = '<div class="empty-state">No runs yet. Start a scrape to see history.</div>';
            return;
        }

        list.innerHTML = state.runs.map(run => {
            const rawDate = run.started_at || run.created_at;
            const dateStr = rawDate ? new Date(rawDate).toLocaleString() : 'Unknown date';
            const date = dateStr === 'Invalid Date' ? (rawDate || 'Unknown date') : dateStr;
            const statusClass = run.status === 'completed' ? 'success' : run.status === 'failed' ? 'error' : 'pending';
            const keyword = run.keyword || run.category || 'Unknown';
            const type = run.run_type || 'keyword';

            return `
                <article class="run-card" data-id="${run.id}">
                    <div class="run-header">
                        <span class="run-status ${statusClass}">${run.status.toUpperCase()}</span>
                        <span class="run-date">${date}</span>
                    </div>
                    <div class="run-details">
                        <h3>${escapeHtml(keyword)}</h3>
                        <p>Type: ${type} · Region: ${run.region || 'UK'} · ID: ${run.id.slice(0, 8)}...</p>
                        <div class="run-stats">
                            <span>Scraped: ${run.products_scraped || 0}</span>
                            <span>New: ${run.products_new || 0}</span>
                            <span>Updated: ${run.products_updated || 0}</span>
                            <span>Filtered: ${run.products_filtered || 0}</span>
                        </div>
                        <div class="run-actions">
                            <button class="view-run-btn primary" data-run-id="${run.id}">👁 View Products</button>
                            <button class="export-run-btn" data-run-id="${run.id}">⬇ Export</button>
                        </div>
                    </div>
                </article>
            `;
        }).join('');

        // Add event listeners for export buttons
        document.querySelectorAll('.export-run-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const runId = e.target.dataset.runId;
                toast('Exporting run products...', 'info');
                window.location.href = `/api/pipeline/export/run/${runId}`;
            });
        });

        // Add event listeners for view buttons
        document.querySelectorAll('.view-run-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const runId = e.target.dataset.runId;
                try {
                    const products = await api(`/products/run/${runId}?limit=200`);
                    const productList = Array.isArray(products) ? products : (products.products || []);
                    state.products = productList;
                    state.page = 1;
                    // Switch view first, then render
                    $all('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'results'));
                    $all('.view').forEach(v => v.classList.toggle('active', v.id === 'view-results'));
                    renderProducts($('#results-list'), productList);
                    toast(`Loaded ${productList.length} products from run`, 'success');
                } catch (err) {
                    toast('Failed to load run products', 'error');
                }
            });
        });
    } catch (err) {
        toast('Failed to load run history', 'error');
    }
}

// ---------- Config bootstrap ----------
async function loadConfig() {
    try {
        const cfg = await api('/config');
        state.config = cfg;
        state.categories = cfg.categories || [];
        
        // Populate category select for scraping
        const scrapeSel = $('#category-select');
        scrapeSel.innerHTML = state.categories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('') || '<option value="">No categories configured</option>';

        populateCategoryFilterOptions();
        
        renderConfigBanner();
    } catch (err) {
        console.warn('[CFG] Failed to load config:', err.message);
    }
}

function renderConfigBanner() {
    const cfg = state.config;
    if (!cfg) return;
    const banner = $('#config-banner');
    const minP = cfg.filters.enableMinimumPrice
        ? `<span>Min price <span class="badge ok">£${cfg.filters.minimumPriceGBP}</span></span>`
        : `<span>Min price <span class="badge warn">off</span></span>`;
    const maxP = cfg.filters.enableMaximumPrice
        ? `<span>Max price <span class="badge ok">£${cfg.filters.maximumPriceGBP}</span></span>`
        : `<span>Max price <span class="badge warn">off</span></span>`;
    const shipW = cfg.filters.maxShippableWeightGrams != null
        ? `<span>Resale-pack ship weight <span class="badge ok">≤${cfg.filters.maxShippableWeightGrams}g</span></span>`
        : '';
    const aiBadge = cfg.ai.provider === 'google'
        ? (cfg.ai.hasApiKey ? `<span class="badge ok">Gemini · ${escapeHtml(cfg.ai.model)}</span>` : `<span class="badge warn">Gemini (no API key — using mock)</span>`)
        : `<span class="badge">${escapeHtml(cfg.ai.provider)}</span>`;
    const cats = cfg.categories?.length
        ? cfg.categories.map(c => `<span class="badge">${escapeHtml(c.name)}</span>`).join('')
        : `<span class="badge warn">none</span>`;
    banner.innerHTML = `
        <span><strong>AI:</strong> ${aiBadge}</span>
        ${minP}
        ${maxP}
        ${shipW}
        <span><strong>Categories:</strong> ${cats}</span>
    `;
    banner.classList.remove('hidden');
}

// ---------- Search & scrape ----------
const form = $('#search-form');
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const region = $('#region-select').value;
    const maxPages = parseInt($('#pages-input').value, 10) || 400;
    const isCat = state.mode === 'category';
    const keyword = $('#keyword-input').value.trim();
    const category = $('#category-select').value;

    if (isCat && !category) return toast('Pick a category', 'error');
    if (!isCat && !keyword) return toast('Enter a keyword', 'error');

    const btn = $('#scrape-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Running…';
    $('#pipeline-progress').classList.remove('hidden');
    $('#scrape-summary').classList.add('hidden');
    $('#scrape-results').innerHTML = '';
    setProgress(isCat ? `Scraping category "${category}"…` : 'Launching browser…', 15);

    try {
        setTimeout(() => setProgress('Scraping product listings across pages…', 35), 1500);
        setTimeout(() => setProgress('Filtering by price & deduplicating…', 55), 4000);
        if (!state.skipAI) {
            setTimeout(() => setProgress('Validating with Google AI Studio (image + metadata)…', 80), 8000);
        } else {
            setTimeout(() => setProgress('Skipping AI enrichment (faster mode)…', 80), 8000);
        }

        // Choose endpoint based on skipAI flag
        const endpointSuffix = state.skipAI ? '/no-ai' : '';
        const endpoint = isCat ? `/scrape/category${endpointSuffix}` : `/scrape${endpointSuffix}`;
        const payload = isCat ? { category, region, maxPages } : { keyword, region, maxPages };
        const data = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });

        setProgress('Complete!', 100);
        renderSummary(data);

        // Show all products from the run, not just top products
        const runProducts = await api(`/products/run/${data.runId}?limit=200`).catch(() => []);
        const toShow = Array.isArray(runProducts) ? runProducts : (runProducts.products || []);
        renderProducts($('#scrape-results'), toShow);

        const s = data.stats || {};
        const f = state.config?.filters;
        const range = f
            ? `${f.enableMinimumPrice ? '≥£' + f.minimumPriceGBP : ''}${f.enableMinimumPrice && f.enableMaximumPrice ? ' & ' : ''}${f.enableMaximumPrice ? '≤£' + f.maximumPriceGBP : ''}`
            : '';
        const modeText = state.skipAI ? ' (no AI)' : '';
        toast(`✓ Pipeline complete${modeText}: ${s.new || 0} new, ${s.updated || 0} updated, ${s.deduplicated || 0} dup, ${s.filtered || 0} filtered${range ? ' (' + range + ')' : ''}`, 'success', 5500);
        updateGlobalStats();
    } catch (err) {
        toast('✗ ' + err.message, 'error', 6000);
        setProgress('Failed: ' + err.message, 0);
    } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Run Pipeline';
        setTimeout(() => $('#pipeline-progress').classList.add('hidden'), 2500);
    }
});

function setProgress(text, pct) {
    $('#progress-text').textContent = text;
    $('.progress-fill').style.width = `${pct}%`;
}

function renderSummary(data) {
    const s = data.stats || {};
    const rs = data.runStats || {};
    const el = $('#scrape-summary');
    el.classList.remove('hidden');
    el.innerHTML = `
        <div class="stat accent"><div class="label">Scraped</div><div class="value">${s.scraped || 0}</div></div>
        <div class="stat green"><div class="label">New</div><div class="value">${s.new || 0}</div></div>
        <div class="stat"><div class="label">Updated</div><div class="value">${s.updated || 0}</div></div>
        <div class="stat"><div class="label">Deduped</div><div class="value">${s.deduplicated || 0}</div></div>
        <div class="stat"><div class="label">Filtered (price)</div><div class="value">${s.filtered || 0}</div></div>
        <div class="stat"><div class="label">Avg Score</div><div class="value">${rs.avg_score != null ? Number(rs.avg_score).toFixed(3) : '—'}</div></div>
        <div class="stat"><div class="label">Bulk Items</div><div class="value">${rs.bulk_products || 0}</div></div>
    `;
}

// ---------- Results view ----------
$('#top-limit').addEventListener('change', e => { state.topLimit = +e.target.value; state.page = 1; loadTopProducts(); });
$('#page-size').addEventListener('change', e => { state.pageSize = +e.target.value; state.page = 1; renderResultsPage(); });
$('#category-filter-mode').addEventListener('change', e => {
    state.categoryFilterMode = e.target.value === 'scrape' ? 'scrape' : 'ai';
    state.page = 1;
    populateCategoryFilterOptions();
    renderResultsPage();
});
$('#category-filter').addEventListener('change', e => { state.category = e.target.value; state.page = 1; renderResultsPage(); });
$('#refresh-top').addEventListener('click', loadTopProducts);
$('#export-btn').addEventListener('click', doExport);

async function loadTopProducts() {
    const list = $('#results-list');
    list.innerHTML = `<div class="empty-state"><h3>Loading…</h3><p>Fetching top ${state.topLimit} products.</p></div>`;
    try {
        const data = await api(`/products/top?limit=${state.topLimit}`);
        state.products = data.products || [];
        if (!state.products.length) {
            list.innerHTML = `<div class="empty-state"><h3>No products yet</h3><p>Run a scrape to populate the database.</p></div>`;
            $('#pager').classList.add('hidden');
            return;
        }
        state.page = 1;
        renderResultsPage();
        updateGlobalStats();
    } catch (err) {
        list.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
    }
}

function renderResultsPage() {
    const list = $('#results-list');
    let items = state.products;
    if (state.category) {
        if (state.categoryFilterMode === 'scrape') {
            const selected = String(state.category).toLowerCase();
            items = items.filter(p => String(p.source_category || '').toLowerCase() === selected);
        } else {
            const selected = String(state.category).toLowerCase();
            items = items.filter(p => String(p.category || '').toLowerCase() === selected);
        }
    }
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * state.pageSize;
    const slice = items.slice(start, start + state.pageSize);

    if (!slice.length) {
        list.innerHTML = `<div class="empty-state"><h3>No matches</h3><p>No products match this filter.</p></div>`;
        $('#pager').classList.add('hidden');
        return;
    }

    renderProducts(list, slice, start);
    renderPager(total, pages);
}

function renderProducts(container, products, rankOffset = 0) {
    container.innerHTML = products.map((p, i) => productCard(p, i + rankOffset + 1)).join('');
    // attach carousel handlers
    container.querySelectorAll('.carousel').forEach(setupCarousel);
}

function getImages(p) {
    if (Array.isArray(p.local_images) && p.local_images.length) {
        const locals = p.local_images
            .map((img) => img?.local_url)
            .filter(Boolean);
        if (locals.length) return locals;
    }

    if (Array.isArray(p.images) && p.images.length) return p.images;
    if (p.local_image_url) return [p.local_image_url];
    if (p.image_url) return [p.image_url];
    return [];
}

function formatPackLabel(p) {
    const qty = p.quantity_estimate != null && !isNaN(p.quantity_estimate)
        ? Math.max(0, Number(p.quantity_estimate))
        : null;

    if (p.is_bulk && (!qty || qty <= 1)) return 'Multipack';
    if (qty && qty > 1) return `${Math.round(qty)} pcs`;
    return '1 pc';
}

function productCard(p, rank) {
    const score = p.final_score;
    const cls = scoreClass(score);
    const bulkTag = p.is_bulk ? `<span class="tag bulk">📦 ${formatPackLabel(p)}</span>` : '';
    const primeTag = p.prime_eligible ? `<span class="tag prime">Prime</span>` : '';
    const catTag = p.category ? `<span class="tag cat">${escapeHtml(p.category)}</span>` : '';
    const resellTag = p.ai_is_resellable === 1
        ? `<span class="tag resellable">✓ Resellable</span>`
        : (p.ai_is_resellable === 0 ? `<span class="tag not-resellable">✗ Not resellable</span>` : '');
    const resalePackShippable = p.ai_is_resale_pack_shippable_under_100g ?? p.ai_is_shippable_under_100g;
    const shipTag = resalePackShippable === 1
        ? `<span class="tag shippable">📮 Resale pack ≤100g</span>`
        : (resalePackShippable === 0 ? `<span class="tag not-shippable">⚠ Resale pack >100g</span>` : '');
    const resaleQty = p.ai_recommended_resale_pack_quantity;
    const resalePackWeight = p.ai_estimated_resale_pack_weight_grams ?? p.ai_estimated_weight_grams;

    const images = getImages(p);
    const carousel = images.length
        ? `<div class="carousel" data-index="0">
              <div class="carousel-track">
                ${images.map(src => `<div class="carousel-slide"><img src="${escapeHtml(src)}" alt="" loading="lazy"/></div>`).join('')}
              </div>
              ${images.length > 1 ? `
                <button class="carousel-arrow prev" aria-label="Previous image">‹</button>
                <button class="carousel-arrow next" aria-label="Next image">›</button>
                <div class="carousel-dots">
                    ${images.map((_, i) => `<button class="carousel-dot ${i === 0 ? 'active' : ''}" data-i="${i}"></button>`).join('')}
                </div>
              ` : ''}
           </div>`
        : `<div class="product-img placeholder">📦</div>`;

    const asin = p.asin ? ` · ${p.asin}` : '';
    const unit = p.unit_price ? ` · unit ${fmtMoney(p.unit_price)}` : '';

    const signals = Array.isArray(p.ai_signals) ? p.ai_signals : [];
    const aiBlock = (p.ai_summary || signals.length)
        ? `<div class="ai-block">
              ${p.ai_summary ? `<div class="ai-summary">🤖 ${escapeHtml(p.ai_summary)}</div>` : ''}
              ${signals.length ? `<div class="ai-signals">${signals.slice(0, 6).map(s => `<span class="signal">${escapeHtml(s)}</span>`).join('')}</div>` : ''}
           </div>`
        : '';

    return `
        <article class="product-card" data-id="${p.id}">
            <label class="product-select">
                <input type="checkbox" class="product-checkbox" data-id="${p.id}" />
                <span class="product-rank">#${rank}</span>
            </label>
            ${score != null ? `<span class="product-score ${cls}">${fmtScore(score)}</span>` : ''}
            ${carousel}
            <div class="product-body">
                <h3 class="product-title"><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a></h3>
                <div class="product-price-row">
                    <div class="product-price">${fmtMoney(p.price)}</div>
                    <div class="product-unit-price">${unit || ''}${asin}</div>
                </div>
                <div class="product-meta">
                    ${catTag}
                    ${bulkTag}
                    ${resellTag}
                    ${shipTag}
                    ${primeTag}
                </div>
                ${aiBlock}
                <div class="product-stats">
                    <span class="rating">${p.rating ? '⭐ ' + p.rating : '—'}</span>
                    <span>${p.review_count || 0} reviews</span>
                    <span>${resaleQty != null ? 'Resale qty: ' + resaleQty : ''}</span>
                    <span>${resalePackWeight != null ? Math.round(resalePackWeight) + 'g resale-pack est.' : ''}</span>
                    <span>${p.resale_suitability ? p.resale_suitability.toUpperCase() : ''}</span>
                </div>
                <div class="product-scores">
                    <div class="score-cell"><strong>${fmtScore(p.bulk_score)}</strong>Bulk</div>
                    <div class="score-cell"><strong>${fmtScore(p.demand_score)}</strong>Demand</div>
                    <div class="score-cell"><strong>${fmtScore(p.trust_score)}</strong>Trust</div>
                    <div class="score-cell"><strong>${fmtScore(p.unit_margin_score)}</strong>Margin</div>
                    <div class="score-cell"><strong>${fmtScore(p.shipping_score)}</strong>Shipping</div>
                </div>
            </div>
        </article>
    `;
}

function setupCarousel(el) {
    const track = el.querySelector('.carousel-track');
    const slides = el.querySelectorAll('.carousel-slide');
    const dots = el.querySelectorAll('.carousel-dot');
    const prev = el.querySelector('.carousel-arrow.prev');
    const next = el.querySelector('.carousel-arrow.next');
    if (slides.length <= 1) return;

    let idx = 0;
    const goTo = (i) => {
        idx = (i + slides.length) % slides.length;
        track.style.transform = `translateX(-${idx * 100}%)`;
        dots.forEach((d, di) => d.classList.toggle('active', di === idx));
        el.dataset.index = idx;
    };
    prev?.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); goTo(idx - 1); });
    next?.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); goTo(idx + 1); });
    dots.forEach(d => d.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); goTo(parseInt(d.dataset.i, 10)); }));
}

function renderPager(total, pages) {
    const pager = $('#pager');
    if (pages <= 1) { pager.classList.add('hidden'); return; }
    pager.classList.remove('hidden');

    const btns = [];
    btns.push(`<button ${state.page === 1 ? 'disabled' : ''} data-p="prev">← Prev</button>`);

    const start = Math.max(1, state.page - 2);
    const end = Math.min(pages, start + 4);
    if (start > 1) btns.push(`<button data-p="1">1</button>${start > 2 ? '<span class="pager-info">…</span>' : ''}`);
    for (let i = start; i <= end; i++) {
        btns.push(`<button class="${i === state.page ? 'active' : ''}" data-p="${i}">${i}</button>`);
    }
    if (end < pages) btns.push(`${end < pages - 1 ? '<span class="pager-info">…</span>' : ''}<button data-p="${pages}">${pages}</button>`);

    btns.push(`<span class="pager-info">${total} items</span>`);
    btns.push(`<button ${state.page === pages ? 'disabled' : ''} data-p="next">Next →</button>`);
    pager.innerHTML = btns.join('');

    pager.querySelectorAll('button[data-p]').forEach(b => {
        b.addEventListener('click', () => {
            const v = b.dataset.p;
            if (v === 'prev') state.page = Math.max(1, state.page - 1);
            else if (v === 'next') state.page = Math.min(pages, state.page + 1);
            else state.page = parseInt(v, 10);
            renderResultsPage();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
}

async function doExport() {
    const btn = $('#export-btn');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Exporting…';
    try {
        const url = `${API}/export/top?limit=${encodeURIComponent(state.topLimit)}`;
        const link = document.createElement('a');
        link.href = url;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast('✓ Export started. Your file should download shortly.', 'success', 5000);
    } catch (err) {
        toast('✗ Export failed: ' + err.message, 'error', 5000);
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

// ---------- Global stats ----------
async function updateGlobalStats() {
    try {
        const data = await api('/products/top?limit=500');
        const products = data.products || [];
        $('#stat-total').textContent = products.length;
        $('#stat-bulk').textContent = products.filter(p => p.is_bulk).length;
        const avg = products.length ? (products.reduce((s, p) => s + (p.final_score || 0), 0) / products.length) : 0;
        $('#stat-avg').textContent = avg ? avg.toFixed(3) : '—';
    } catch (e) { /* silent */ }
}

// ---------- Init ----------
loadConfig();
updateGlobalStats();
