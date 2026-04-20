/**
 * DFS Order Preview — Tooltips BO
 * @author Cyrille Mohr - Digital Food System
 */

'use strict';

(function () {

    // -------------------------------------------------------------------------
    // Configuration — injectée par PHP via Media::addJsDef()
    // dfsOp.urlProducts / dfsOp.urlDelivery / dfsOp.urlCustomer
    // -------------------------------------------------------------------------

    if (typeof dfsOp === 'undefined') {
        return;
    }

    // Mapping data-column-id (PS9 attribute on <th>) → type de tooltip
    // Confirmed via DevTools inspection of PS9 order grid.
    const COLUMN_MAP = {
        'id_order':     'products',
        'reference':    'products',
        'new':          'products',
        'country_name': 'delivery',
        'customer':     'customer',
    };

    const URL_MAP = {
        products: dfsOp.urlProducts,
        delivery: dfsOp.urlDelivery,
        customer: dfsOp.urlCustomer,
    };

    // Délai avant affichage (ms) — évite les tooltips intempestifs au survol rapide
    const HOVER_DELAY = 150;

    // Cache client-side : durée = session courante
    const cache = new Map();

    // -------------------------------------------------------------------------
    // Création du container tooltip (un seul dans le DOM, réutilisé)
    // Créé lazily dans init() pour garantir que <body> est disponible.
    // -------------------------------------------------------------------------

    let tooltip = null;

    function ensureTooltip() {
        if (tooltip) return;
        tooltip = document.createElement('div');
        tooltip.id = 'dfs-op-tooltip';
        tooltip.className = 'dfs-op-tooltip dfs-op-tooltip--hidden';
        tooltip.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltip);
    }

    // -------------------------------------------------------------------------
    // Positionnement
    // -------------------------------------------------------------------------

    function positionTooltip(cell) {
        const rect      = cell.getBoundingClientRect();
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

        let top  = rect.bottom + scrollTop + 6;
        let left = rect.left + scrollLeft;

        // Ajustement si débordement à droite
        const tipWidth = tooltip.offsetWidth || 280;
        if (left + tipWidth > window.innerWidth + scrollLeft - 16) {
            left = window.innerWidth + scrollLeft - tipWidth - 16;
        }

        // Ajustement si débordement en bas → afficher au-dessus
        const tipHeight = tooltip.offsetHeight || 120;
        if (top - scrollTop + tipHeight > window.innerHeight) {
            top = rect.top + scrollTop - tipHeight - 6;
        }

        tooltip.style.top  = top + 'px';
        tooltip.style.left = left + 'px';
    }

    // -------------------------------------------------------------------------
    // Rendu du contenu selon le type et les données JSON
    // -------------------------------------------------------------------------

    function renderProducts(data) {
        if (!data.lines || data.lines.length === 0) {
            return '<p class="dfs-op-empty">Aucun produit</p>';
        }
        const rows = data.lines.map(line =>
            `<div class="dfs-op-row">
                <span class="dfs-op-product-name">${escHtml(line.name)}</span>
                <span class="dfs-op-qty">× ${line.qty}</span>
             </div>`
        ).join('');
        return `<div class="dfs-op-block">${rows}</div>`;
    }

    function renderDelivery(data) {
        // Cas retrait boutique (DFS Click & Collect)
        // Le champ data.carrier porte déjà le label enrichi : "Retrait en boutique — Boutique de Strasbourg"
        // data.clickcollect contient uniquement { day, hour } (store_name absorbé dans carrier côté PHP)
        if (data.clickcollect !== null && data.clickcollect !== undefined) {
            const cc = data.clickcollect;
            let html = `<div class="dfs-op-block">
                <div class="dfs-op-row">${escHtml(data.carrier)}</div>`;
            if (cc.day || cc.hour) {
                html += `<div class="dfs-op-slot">`;
                if (cc.day)  html += `<span>${escHtml(cc.day)}</span>`;
                if (cc.hour) html += `<span> · ${escHtml(cc.hour)}</span>`;
                html += `</div>`;
            }
            html += `</div>`;
            return html;
        }

        // Cas livraison classique
        const lines = [
            data.carrier,
            (data.firstname || '') + ' ' + (data.lastname || ''),
            data.address1,
            data.address2,
            (data.postcode || '') + ' ' + (data.city || ''),
            data.phone,
        ].filter(Boolean);

        return `<div class="dfs-op-block">` +
            lines.map(l => `<div class="dfs-op-row">${escHtml(l.trim())}</div>`).join('') +
            `</div>`;
    }

    function renderCustomer(data) {
        const lines = [];
        if (data.firstname || data.lastname) {
            lines.push(`<div class="dfs-op-row dfs-op-row--name">${escHtml((data.firstname + ' ' + data.lastname).trim())}</div>`);
        }
        if (data.phone) {
            lines.push(`<div class="dfs-op-row">📞 ${escHtml(data.phone)}</div>`);
        }
        if (data.email) {
            lines.push(`<div class="dfs-op-row">✉ ${escHtml(data.email)}</div>`);
        }
        return `<div class="dfs-op-block">${lines.join('')}</div>`;
    }

    const RENDERERS = {
        products: renderProducts,
        delivery: renderDelivery,
        customer: renderCustomer,
    };

    // -------------------------------------------------------------------------
    // Affichage / masquage
    // -------------------------------------------------------------------------

    function showTooltip(html, cell) {
        tooltip.innerHTML = html;
        tooltip.classList.remove('dfs-op-tooltip--hidden');
        positionTooltip(cell);
    }

    function hideTooltip() {
        tooltip.classList.add('dfs-op-tooltip--hidden');
        tooltip.innerHTML = '';
    }

    function showLoading(cell) {
        tooltip.innerHTML = '<div class="dfs-op-loading"><span class="dfs-op-spinner"></span></div>';
        tooltip.classList.remove('dfs-op-tooltip--hidden');
        positionTooltip(cell);
    }

    function showError() {
        tooltip.innerHTML = '<div class="dfs-op-error">Données indisponibles</div>';
    }

    // -------------------------------------------------------------------------
    // Chargement AJAX
    // -------------------------------------------------------------------------

    function buildUrl(type, orderId) {
        // Replace /0 before query params (Symfony _token) or at end of string
        return URL_MAP[type].replace(/\/0(\?|$)/, '/' + orderId + '$1');
    }

    async function fetchTooltipData(type, orderId) {
        const cacheKey = type + '-' + orderId;

        if (cache.has(cacheKey)) {
            return cache.get(cacheKey);
        }

        const response = await fetch(buildUrl(type, orderId), {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
        });

        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }

        const data = await response.json();
        cache.set(cacheKey, data);
        return data;
    }

    // -------------------------------------------------------------------------
    // Initialisation sur la grille commandes
    // -------------------------------------------------------------------------

    function init() {
        const table = document.getElementById('order_grid_table');
        if (!table) {
            return;
        }

        // Garantit que le div tooltip est dans le DOM (body disponible à ce stade)
        ensureTooltip();

        // --- Cartographie des colonnes par index ---
        // PS9 uses data-column-id directly on <th> elements
        const columnIndex = {};

        table.querySelectorAll('thead th').forEach((th, index) => {
            const colId = th.getAttribute('data-column-id');
            if (!colId) return;

            const type = COLUMN_MAP[colId];
            if (type && !(colId in columnIndex)) {
                columnIndex[colId] = index;
            }
        });

        // --- Attache des événements sur chaque ligne ---
        table.querySelectorAll('tbody tr').forEach(row => {
            const checkbox = row.querySelector('.js-bulk-action-checkbox');
            if (!checkbox) return;

            const orderId = parseInt(checkbox.value, 10);
            if (!orderId) return;

            Object.entries(columnIndex).forEach(([colId, tdIndex]) => {
                const type = COLUMN_MAP[colId];
                const cell = row.children[tdIndex];
                if (!cell) return;

                attachTooltip(cell, type, orderId);
            });
        });

        // Enrichissement de la preview row (ligne dépliable) pour les commandes C&C
        initPreviewRowEnricher(table);
    }

    // -------------------------------------------------------------------------
    // Gestion hover avec debounce
    // -------------------------------------------------------------------------

    function attachTooltip(cell, type, orderId) {
        let timer = null;

        cell.addEventListener('mouseenter', () => {
            timer = setTimeout(async () => {
                showLoading(cell);
                try {
                    const data = await fetchTooltipData(type, orderId);
                    const html = RENDERERS[type](data);
                    showTooltip(html, cell);
                } catch (e) {
                    showError();
                }
            }, HOVER_DELAY);
        });

        cell.addEventListener('mouseleave', () => {
            clearTimeout(timer);
            hideTooltip();
        });
    }

    // -------------------------------------------------------------------------
    // Utilitaires
    // -------------------------------------------------------------------------

    function escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // -------------------------------------------------------------------------
    // Preview Row — enrichissement du nom du transporteur C&C
    // -------------------------------------------------------------------------

    /**
     * Enrichit la ligne dépliable (preview row PS9) quand elle s'ouvre.
     *
     * Stratégie :
     * 1. Écoute les clics sur .preview-toggle dans la grille
     * 2. Récupère l'orderId depuis la checkbox de la ligne parente
     * 3. Appelle deliveryAction (avec cache) → si C&C (clickcollect !== null),
     *    remplace le texte "Retrait en boutique" par le carrier enrichi
     * 4. Détecte l'injection de tr.preview-row via MutationObserver (la row
     *    est injectée de façon asynchrone par PS9 après le clic)
     *
     * Ne touche à rien si :
     * - La commande n'est pas C&C (clickcollect === null)
     * - Le nœud texte attendu n'est pas trouvé (fail silencieux)
     */
    function initPreviewRowEnricher(table) {
        table.addEventListener('click', function (e) {
            // Cible : le toggle de preview (flèche ▶ de la ligne)
            const toggle = e.target.closest('.preview-toggle');
            if (!toggle) return;

            // La ligne parente de données (tr contenant la checkbox et le toggle)
            const dataRow = toggle.closest('tr');
            if (!dataRow) return;

            const checkbox = dataRow.querySelector('.js-bulk-action-checkbox');
            if (!checkbox) return;

            const orderId = parseInt(checkbox.value, 10);
            if (!orderId) return;

            // Observer sur le tbody pour détecter l'injection de tr.preview-row
            const observer = new MutationObserver(function (mutations) {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (
                            node.nodeType === 1 &&
                            node.tagName === 'TR' &&
                            node.classList.contains('preview-row')
                        ) {
                            observer.disconnect();
                            applyCarrierEnrichment(node, orderId);
                            return;
                        }
                    }
                }
            });

            observer.observe(table.querySelector('tbody') || table, {
                childList: true,
                subtree: false,
            });

            // Sécurité : déconnecte l'observer après 3s si rien n'est injecté
            setTimeout(() => observer.disconnect(), 3000);
        });
    }

    /**
     * Remplace le texte du transporteur dans la preview row si la commande
     * est un retrait boutique (clickcollect !== null).
     *
     * @param {HTMLElement} previewRow  La tr.preview-row injectée par PS9
     * @param {number}      orderId     L'ID de la commande
     */
    async function applyCarrierEnrichment(previewRow, orderId) {
        try {
            const data = await fetchTooltipData('delivery', orderId);

            // Si ce n'est pas une commande C&C → ne rien faire
            if (!data || data.clickcollect === null || data.clickcollect === undefined) {
                return;
            }

            // Cherche le nœud texte du transporteur dans le bloc shipping
            // Structure PS9 : div[data-role="shipping-details"] > p > strong + texte
            const shippingBlock = previewRow.querySelector('[data-role="shipping-details"]');
            if (!shippingBlock) return;

            // Cherche le <strong> qui contient "Transporteur" (insensible à la casse)
            const strongs = shippingBlock.querySelectorAll('strong');
            let carrierTextNode = null;

            for (const strong of strongs) {
                if (/transporteur/i.test(strong.textContent)) {
                    // Le texte du transporteur est le nœud texte suivant
                    let sibling = strong.nextSibling;
                    while (sibling) {
                        if (sibling.nodeType === 3 && sibling.textContent.trim()) {
                            carrierTextNode = sibling;
                            break;
                        }
                        sibling = sibling.nextSibling;
                    }
                    break;
                }
            }

            if (!carrierTextNode) return;

            // Remplace le texte par le carrier enrichi (déjà composé côté PHP)
            carrierTextNode.textContent = ' ' + data.carrier;

        } catch (e) {
            // Fail silencieux : ne jamais perturber l'affichage natif
        }
    }

    // -------------------------------------------------------------------------
    // Lancement
    // -------------------------------------------------------------------------

    function waitAndInit() {
        // Guard: dfsOp must be defined (injected by PHP via Media::addJsDef)
        if (typeof dfsOp === 'undefined') {
            return;
        }

        const table = document.getElementById('order_grid_table');

        if (table) {
            init();
            return;
        }

        // Grid not yet in DOM — watch for it (PS9 loads grid via XHR in some cases)
        const observer = new MutationObserver(function () {
            if (document.getElementById('order_grid_table')) {
                observer.disconnect();
                init();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitAndInit);
    } else {
        waitAndInit();
    }

})();
