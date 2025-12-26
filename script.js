function fuzzyScore(source, target) {
    if (!source || !target) return Infinity;
    const s = source.toLowerCase();
    const t = target.toLowerCase();
    let score = 0; let t_ptr = 0;
    for (let s_ptr = 0; s_ptr < s.length; s_ptr++) { if (t_ptr < t.length && s[s_ptr] === t[t_ptr]) { t_ptr++; } else { score += 1; } }
    if (t_ptr < t.length) score += (t.length - t_ptr) * 10;
    if (s[0] !== t[0]) score += 2;
    return score;
}

class NotionApp {
    constructor() {
        const defaultData = [
            { id: 'root', title: 'Getting Started', icon: '👋', fullWidth: false, smallText: false, toc: false, parentId: null, sidebarCollapsed: false, favorite: false, blocks: [{ id: 'b1', type: 'h1', content: 'Welcome' }] }
        ];
        this.pages = JSON.parse(localStorage.getItem('notion_pages')) || defaultData;
        this.activePageId = localStorage.getItem('notion_active_page') || this.pages[0].id;
        this.trash = JSON.parse(localStorage.getItem('notion_trash')) || [];

        this.sectionSort = { favorites: 'manual', private: 'manual' }; // 'manual' or 'title'

        this.lastRange = null;

        this.sidebarOpen = true;
        this.activeBlockId = null; this.draggedBlockId = null; this.contextBlockId = null; this.contextPageId = null; this.pendingImageBlockId = null;
        this.renamingPageId = null;
        this.contextSection = null; // for section menu

        // **NEW: Block System Properties**
        this.slashCommandMenu = null; // Stores reference to slash command menu
        this.blockTypes = ['text', 'h1', 'h2', 'h3', 'todo', 'bullet', 'quote', 'callout', 'code', 'divider', 'page'];
        this.activeBlockIdForMenu = null; // Stores which block triggered the menu
        this.slashMenuOpen = false;
        this.slashMenuIndex = 0;

        // Search & Move State
        this.searchOpen = false;
        this.moveMode = false;
        this.pageToMoveId = null;
        this.searchResults = [];
        this.searchSelectedIndex = 0;
        this.sortedPagesCache = [];

        this.init();
    }

    init() {
        this.renderSidebar();
        this.loadPage(this.activePageId);
        this.setupGlobalEvents();
        lucide.createIcons();
    }

    save() {
        localStorage.setItem('notion_pages', JSON.stringify(this.pages));
        localStorage.setItem('notion_trash', JSON.stringify(this.trash));
        localStorage.setItem('notion_active_page', this.activePageId);
        this.renderSidebar();
    }

    // --- MENU ACTIONS ---
    sharePage() { alert("Share modal would open here."); }
    toggleComments() { alert("Comments section toggled."); }

    toggleMoreActionsMenu(event) {
        if (event) event.stopPropagation();
        this.closeAllPopups();
        const menu = document.getElementById('more-actions-menu');

        // Update text based on state
        const p = this.getCurrentPage();

        // Highlight fonts
        document.querySelectorAll('.font-card').forEach(el => el.classList.remove('selected'));
        if (p.font === 'serif') document.getElementById('font-card-serif').classList.add('selected');
        else if (p.font === 'mono') document.getElementById('font-card-mono').classList.add('selected');
        else document.getElementById('font-card-default').classList.add('selected');

        // Update Toggles - ADDED TOC check
        document.getElementById('toggle-small-text').className = 'toggle-track' + (p.smallText ? ' on' : '');
        document.getElementById('toggle-full-width').className = 'toggle-track' + (p.fullWidth ? ' on' : '');
        document.getElementById('toggle-toc').className = 'toggle-track' + (p.toc ? ' on' : ''); // Blue toggle for TOC
        document.getElementById('toggle-lock-page').className = 'toggle-track' + (p.locked ? ' on' : '');

        // Ensure it's not hidden
        menu.style.display = 'flex';

        // Position logic for top right menu
        const rect = event.currentTarget.getBoundingClientRect();
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.left = 'auto';
        menu.style.right = '12px'; // Align to right edge of screen/container
    }

    duplicatePageMenuAction() {
        const current = this.getCurrentPage();
        this.duplicatePageRecursive(current, current.parentId);
        this.save();
        this.closeAllPopups();
    }
    closeAllPopups() {
        document.getElementById('more-actions-menu').style.display = 'none';
        document.getElementById('block-menu').style.display = 'none';
        document.getElementById('sidebar-menu').style.display = 'none';
        document.getElementById('move-to-popup').style.display = 'none';
        document.getElementById('section-menu').style.display = 'none';
        this.closeSlashMenu();
    }

    // --- UPDATED SEARCH ---
    toggleSearch() {
        this.searchOpen = !this.searchOpen;
        this.moveMode = false;

        const overlay = document.getElementById('search-overlay');
        const input = document.getElementById('search-input');
        const icon = document.getElementById('search-icon-display');

        if (this.searchOpen) {
            overlay.style.display = 'flex';
            input.value = '';
            input.placeholder = 'Search pages or blocks...';
            icon.setAttribute('data-lucide', 'search');
            lucide.createIcons();

            this.sortedPagesCache = [...this.pages].sort((a, b) => (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase()));
            this.searchResults = this.sortedPagesCache;
            this.renderSearchResults();
            input.focus();
        } else {
            overlay.style.display = 'none';
        }
    }

    handleSearchInput(e) {
        const query = e.target.value.toLowerCase().trim();
        let candidates = this.sortedPagesCache.length ? this.sortedPagesCache : this.pages;

        if (!query) {
            this.searchResults = candidates;
            this.renderSearchResults();
            return;
        }

        const MAX_SCORE = 50;
        let scoredResults = candidates.map(page => ({
            page: page, score: fuzzyScore(page.title || "", query)
        })).filter(item => item.score < MAX_SCORE);
        scoredResults.sort((a, b) => a.score - b.score);
        this.searchResults = scoredResults.map(item => item.page);
        this.searchSelectedIndex = 0;
        this.renderSearchResults();
    }

    renderSearchResults() {
        const container = document.getElementById('search-results-list');
        container.innerHTML = '';
        if (this.searchResults.length === 0) {
            container.innerHTML = `<div class="search-empty">No results found.</div>`;
            return;
        }
        const fragment = document.createDocumentFragment();
        this.searchResults.forEach((page, index) => {
            const breadcrumbs = this.getBreadcrumbsString(page.id);
            const isSelected = index === this.searchSelectedIndex;
            const item = document.createElement('div');
            item.className = `search-result-item ${isSelected ? 'selected' : ''}`;
            item.onclick = () => { this.loadPage(page.id); this.toggleSearch(); };
            item.innerHTML = `
                <div class="search-item-icon">${page.icon || '📄'}</div>
                <div class="search-item-info">
                    <div class="search-item-title">${page.title || 'Untitled'}</div>
                    <div class="search-item-breadcrumb">${breadcrumbs}</div>
                </div>`;
            fragment.appendChild(item);
        });
        container.appendChild(fragment);
        const selectedEl = container.children[this.searchSelectedIndex];
        if (selectedEl) selectedEl.scrollIntoView({ block: 'nearest' });
    }

    navigateSearch(direction) {
        if (this.searchResults.length === 0) return;
        if (direction === 'down') this.searchSelectedIndex = (this.searchSelectedIndex + 1) % this.searchResults.length;
        else this.searchSelectedIndex = (this.searchSelectedIndex - 1 + this.searchResults.length) % this.searchResults.length;
        this.renderSearchResults();
    }

    getBreadcrumbsString(pageId) {
        const crumbs = [];
        let curr = this.getPage(pageId);
        while (curr) { crumbs.unshift(curr.title || 'Untitled'); curr = this.pages.find(p => p.id === curr.parentId); }
        return crumbs.join(' / ');
    }

    // --- Page Management ---
    getPage(id) { return this.pages.find(p => p.id === id); }
    getCurrentPage() { return this.getPage(this.activePageId); }

    addPage(parentId = null) {
        const newPage = { id: 'page_' + Date.now(), title: '', icon: '📄', parentId: parentId, sidebarCollapsed: false, favorite: false, blocks: [{ id: 'block_' + Date.now(), type: 'text', content: '' }] };
        this.pages.push(newPage);
        if (parentId) {
            const parent = this.getPage(parentId);
            if (parent) {
                parent.sidebarCollapsed = false;
                parent.blocks.push({ id: 'block_' + Date.now() + '_link', type: 'page', pageId: newPage.id, content: '' });
                if (this.activePageId === parentId) this.loadPage(parentId);
            }
        }
        if (!parentId) this.loadPage(newPage.id);
        this.save(); return newPage;
    }

    addPageToFavorites(e) {
        if (e) e.stopPropagation();
        const newPage = this.addPage(null);
        newPage.favorite = true;
        this.save();
        this.loadPage(newPage.id);
    }

    deleteCurrentPage() {
        const p = this.getCurrentPage();
        if (this.pages.length <= 1) return alert("Cannot delete the last page.");
        if (!confirm(`Delete page "${p.title || 'Untitled'}"?`)) return;
        this.moveToTrash(p.id);
        this.activePageId = this.pages[0].id;
        this.save(); this.loadPage(this.activePageId);
    }

    moveToTrash(pageId) {
        const page = this.getPage(pageId);
        if (!page) return;
        const children = this.pages.filter(p => p.parentId === pageId);
        children.forEach(c => this.moveToTrash(c.id));
        this.trash.push(page);
        this.pages = this.pages.filter(p => p.id !== pageId);
        this.pages.forEach(p => { p.blocks = p.blocks.filter(b => b.type !== 'page' || b.pageId !== pageId); });
    }

    toggleFavorite() { const p = this.getCurrentPage(); p.favorite = !p.favorite; this.save(); this.updateFavoriteBtn(); }
    updateFavoriteBtn() { const p = this.getCurrentPage(); const btn = document.getElementById('favorite-btn'); if (p.favorite) btn.classList.add('active-star'); else btn.classList.remove('active-star'); }

    exportPage() {
        const p = this.getCurrentPage();
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(p, null, 2));
        const node = document.createElement('a'); node.setAttribute("href", dataStr); node.setAttribute("download", (p.title || "page") + ".json");
        document.body.appendChild(node); node.click(); node.remove();
    }

    // --- Rendering ---
    loadPage(id) {
        const page = this.getPage(id);
        if (!page) { this.loadPage(this.pages[0].id); return; }
        this.activePageId = id;

        // **NEW: Migrate old simple blocks to Block Object structure**
        page.blocks = page.blocks.map(block => {
            if (typeof block === 'string') {
                // Old format: just a string
                return { id: 'block_' + Date.now() + '_' + Math.random(), type: 'text', content: block };
            } else if (!block.id) {
                // Block object but missing ID
                return { ...block, id: 'block_' + Date.now() + '_' + Math.random() };
            }
            return block; // Already in correct format
        });

        const container = document.getElementById('editor-container');
        const titleEl = document.getElementById('page-title');
        const iconWrapper = document.getElementById('page-icon-wrapper');
        const btnAddIcon = document.getElementById('btn-add-icon');

        titleEl.innerText = page.title;
        titleEl.oninput = (e) => { page.title = e.target.innerText; this.save(); };

        if (page.icon) { iconWrapper.classList.remove('hidden'); document.getElementById('page-icon').innerText = page.icon; btnAddIcon.style.display = 'none'; }
        else { iconWrapper.classList.add('hidden'); btnAddIcon.style.display = 'flex'; }

        // Fonts & Styles applied during toggle actions, re-applied here just in case
        container.className = '';
        if (page.smallText) container.classList.add('small-text');
        if (page.fullWidth) container.classList.add('full-width');
        if (page.font === 'serif') container.classList.add('font-serif');
        else if (page.font === 'mono') container.classList.add('font-mono');

        // Lock
        if (page.locked) { container.classList.add('locked'); titleEl.contentEditable = false; }
        else { container.classList.remove('locked'); titleEl.contentEditable = true; }

        this.updateFavoriteBtn();
        this.renderBreadcrumbs(page);

        const blockContainer = document.getElementById('blocks-area');
        blockContainer.innerHTML = '';
        page.blocks.forEach(block => { blockContainer.appendChild(this.createBlockElement(block)); });

        this.renderSidebar();
        lucide.createIcons();
    }

    renderBreadcrumbs(page) {
        const crumbs = []; let curr = page;
        while (curr) { crumbs.unshift(curr); curr = this.pages.find(p => p.id === curr.parentId); }
        const bcEl = document.getElementById('breadcrumbs');
        bcEl.innerHTML = crumbs.map((p, i) => `
            <div class="crumb-item" onclick="app.loadPage('${p.id}')">
                <span style="font-size: 16px;">${p.icon || '📄'}</span> 
                <span class="truncate" style="max-width: 100px;">${p.title || 'Untitled'}</span>
            </div>
            ${i < crumbs.length - 1 ? '<span class="crumb-separator">/</span>' : ''}
        `).join('');
    }

    renderSidebar() {
        const list = document.getElementById('page-list');
        const favList = document.getElementById('favorites-list');
        const favSection = document.getElementById('favorites-section');
        list.innerHTML = ''; favList.innerHTML = '';

        // Favorites Logic
        let favorites = this.pages.filter(p => p.favorite);
        // Sort Favorites
        if (this.sectionSort.favorites === 'title') {
            favorites.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        } else {
            // manual/default (creation order mostly unless reordered)
        }

        if (favorites.length > 0) {
            favSection.classList.remove('hidden');
            favorites.forEach(page => { this.renderSidebarItem(page, favList); });
        } else { favSection.classList.add('hidden'); }

        document.getElementById('trash-count').innerText = this.trash.length;
        this.renderTree(list, null, 0);
        lucide.createIcons();
    }

    renderSidebarItem(page, container) {
        const el = document.createElement('div');
        const isActive = page.id === this.activePageId;

        el.className = `sidebar-row group/item ${isActive ? 'active' : ''}`;
        el.dataset.pageId = page.id;
        el.onclick = (e) => {
            if (!e.target.closest('.action-btn')) {
                this.loadPage(page.id);
            }
        };

        const iconBox = document.createElement('div');
        iconBox.className = 'page-icon-box';
        iconBox.innerHTML = `<span class="page-icon-text">${page.icon || '📄'}</span>`;

        const titleEl = document.createElement('span');
        titleEl.className = 'truncate text-sm w-full';
        titleEl.innerText = page.title || 'Untitled';

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'sidebar-actions';

        const moreBtn = document.createElement('div');
        moreBtn.className = 'action-btn';
        moreBtn.innerHTML = `<i data-lucide="more-horizontal" class="icon-xs"></i>`;
        moreBtn.onclick = (e) => this.openSidebarMenu(e, page.id);

        const addBtn = document.createElement('div');
        addBtn.className = 'action-btn';
        addBtn.style.marginLeft = '2px';
        addBtn.innerHTML = `<i data-lucide="plus" class="icon-xs"></i>`;
        addBtn.onclick = (e) => { e.stopPropagation(); const newPage = this.addPage(page.id); this.loadPage(newPage.id); };

        actionsDiv.appendChild(moreBtn);
        actionsDiv.appendChild(addBtn);

        el.appendChild(iconBox);
        el.appendChild(titleEl);
        el.appendChild(actionsDiv);

        container.appendChild(el);
    }

    renderTree(container, parentId, depth) {
        // Private Section Sorting
        let children = this.pages.filter(p => p.parentId === parentId);

        if (parentId === null && this.sectionSort.private === 'title') {
            children.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        }

        if (children.length === 0) return;
        const childrenContainer = document.createElement('div');
        if (depth > 0) childrenContainer.className = 'sidebar-children-container';

        children.forEach(page => {
            const hasChildren = this.pages.some(p => p.parentId === page.id);
            const itemWrapper = document.createElement('div');
            itemWrapper.className = 'sidebar-item-container';

            // Row Content
            const row = document.createElement('div');
            const isActive = page.id === this.activePageId;
            row.className = `sidebar-row group/item ${isActive ? 'active' : ''}`;
            row.dataset.pageId = page.id;
            row.onclick = (e) => { if (e.target.tagName !== 'INPUT') { e.stopPropagation(); this.loadPage(page.id); } };

            const iconBox = document.createElement('div');
            iconBox.className = 'page-icon-box';
            const iconSpan = document.createElement('span');
            iconSpan.className = 'page-icon-text';
            iconSpan.innerText = page.icon || '📄';
            iconBox.appendChild(iconSpan);

            if (hasChildren) {
                const toggleOverlay = document.createElement('div');
                toggleOverlay.className = 'page-toggle-overlay';
                toggleOverlay.innerHTML = `<i data-lucide="${page.sidebarCollapsed ? 'chevron-right' : 'chevron-down'}" class="icon-xs" style="color: white;"></i>`;
                toggleOverlay.onclick = (e) => { e.stopPropagation(); page.sidebarCollapsed = !page.sidebarCollapsed; this.save(); };
                iconBox.appendChild(toggleOverlay);
            }

            let titleEl;
            if (this.renamingPageId === page.id) {
                titleEl = document.createElement('input'); titleEl.type = 'text'; titleEl.className = 'sidebar-rename-input'; titleEl.value = page.title;
                titleEl.onclick = (e) => e.stopPropagation(); titleEl.onblur = (e) => this.finishRename(page.id, e.target.value);
                titleEl.onkeydown = (e) => this.handleRenameKeydown(e, page.id);
            } else {
                titleEl = document.createElement('span'); titleEl.className = 'truncate text-sm w-full'; titleEl.innerText = page.title || 'Untitled';
            }

            const actionsDiv = document.createElement('div'); actionsDiv.className = 'sidebar-actions';
            const moreBtn = document.createElement('div'); moreBtn.className = 'action-btn'; moreBtn.innerHTML = `<i data-lucide="more-horizontal" class="icon-xs"></i>`;
            moreBtn.onclick = (e) => this.openSidebarMenu(e, page.id);
            const addBtn = document.createElement('div'); addBtn.className = 'action-btn'; addBtn.style.marginLeft = '2px'; addBtn.innerHTML = `<i data-lucide="plus" class="icon-xs"></i>`;
            addBtn.onclick = (e) => { e.stopPropagation(); const newPage = this.addPage(page.id); this.loadPage(newPage.id); };

            actionsDiv.appendChild(moreBtn); actionsDiv.appendChild(addBtn);
            row.appendChild(iconBox); row.appendChild(titleEl); row.appendChild(actionsDiv);
            itemWrapper.appendChild(row);

            if (hasChildren && !page.sidebarCollapsed) this.renderTree(itemWrapper, page.id, depth + 1);
            childrenContainer.appendChild(itemWrapper);
        });
        container.appendChild(childrenContainer);
    }

    positionPopup(popup, triggerRect) {
        popup.style.position = 'fixed';
        let top = triggerRect.bottom + 2;
        let left = triggerRect.left;
        popup.style.display = 'flex';
        const menuHeight = popup.offsetHeight || 300;
        const menuWidth = popup.offsetWidth || 260;
        const windowHeight = window.innerHeight;
        const windowWidth = window.innerWidth;

        if (top + menuHeight > windowHeight - 10) {
            const topIfFlipped = triggerRect.top - menuHeight - 2;
            if (topIfFlipped >= 10) top = topIfFlipped; else top = windowHeight - menuHeight - 10;
        }

        if (left + menuWidth > windowWidth) left = windowWidth - menuWidth - 10;
        if (top < 0) top = 10;

        popup.style.top = top + 'px';
        popup.style.left = left + 'px';
    }

    openSidebarMenu(e, pageId) {
        e.stopPropagation();
        this.closeAllPopups();
        this.contextPageId = pageId;
        const menu = document.getElementById('sidebar-menu');
        const page = this.getPage(pageId);
        const favText = document.getElementById('ctx-fav-text');
        if (page.favorite) favText.innerText = "Remove from Favorites";
        else favText.innerText = "Add to Favorites";
        const triggerRect = e.currentTarget.getBoundingClientRect();
        this.positionPopup(menu, triggerRect);
    }

    // --- FEATURE 1: SIDEBAR SECTION MENU LOGIC (Matches Screenshot 1) ---
    openSectionMenu(e, section) {
        e.stopPropagation();
        this.closeAllPopups();
        this.contextSection = section;
        const menu = document.getElementById('section-menu');

        // Update Sort Label with Visual Indicator
        const label = document.getElementById('section-sort-label');
        const currentSort = this.sectionSort[section];
        // Added indicator icon to label
        label.innerHTML = (currentSort === 'title' ? 'Title' : 'Manual') + ' <i data-lucide="chevron-right" class="icon-xs"></i>';

        const triggerRect = e.currentTarget.getBoundingClientRect();
        this.positionPopup(menu, triggerRect);

        lucide.createIcons(); // refresh icons inside menu
    }

    setSectionSort(sortType) {
        if (this.contextSection) {
            // Toggle Logic
            const current = this.sectionSort[this.contextSection];
            const next = current === 'title' ? 'manual' : 'title';
            this.sectionSort[this.contextSection] = next;
            this.renderSidebar();
        }
        document.getElementById('section-menu').style.display = 'none';
    }

    sidebarActionDelete() {
        if (this.contextPageId) {
            const page = this.getPage(this.contextPageId);
            if (this.pages.length <= 1) return alert("Cannot delete the last page.");
            if (confirm(`Delete page "${page.title || 'Untitled'}"?`)) {
                this.moveToTrash(this.contextPageId);
                if (this.activePageId === this.contextPageId || !this.getPage(this.activePageId)) this.loadPage(this.pages[0].id); else this.save();
            }
        }
        document.getElementById('sidebar-menu').style.display = 'none';
    }

    sidebarActionDuplicate() {
        if (this.contextPageId) { const original = this.getPage(this.contextPageId); this.duplicatePageRecursive(original, original.parentId); this.save(); }
        document.getElementById('sidebar-menu').style.display = 'none';
    }

    sidebarActionRename() {
        if (this.contextPageId) {
            this.renamingPageId = this.contextPageId;
            this.renderSidebar();
            document.getElementById('sidebar-menu').style.display = 'none';
            setTimeout(() => { const input = document.querySelector('.sidebar-rename-input'); if (input) { input.focus(); input.select(); } }, 50);
        }
    }

    finishRename(pageId, newTitle) {
        if (this.renamingPageId === pageId) {
            const page = this.getPage(pageId);
            if (page) {
                page.title = newTitle; this.save();
                if (this.activePageId === pageId) { document.getElementById('page-title').innerText = page.title; }
            }
            this.renamingPageId = null; this.renderSidebar();
        }
    }

    handleRenameKeydown(e, pageId) {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); this.finishRename(pageId, e.target.value); }
        else if (e.key === 'Escape') { e.preventDefault(); this.renamingPageId = null; this.renderSidebar(); }
    }

    sidebarActionFavorite() {
        if (this.contextPageId) { const page = this.getPage(this.contextPageId); page.favorite = !page.favorite; this.save(); if (this.activePageId === this.contextPageId) this.updateFavoriteBtn(); }
        this.renderSidebar();
        document.getElementById('sidebar-menu').style.display = 'none';
    }

    sidebarActionCopyLink() {
        const dummy = document.createElement('textarea');
        dummy.value = window.location.href;
        document.body.appendChild(dummy);
        dummy.select();
        document.execCommand('copy');
        document.body.removeChild(dummy);

        this.showToast("Copied link to clipboard");

        document.getElementById('sidebar-menu').style.display = 'none';
    }
    copyLinkToClipboard() { this.sidebarActionCopyLink(); }

    showToast(msg) {
        const toast = document.getElementById('toast-notification');
        toast.innerText = msg;
        toast.style.display = 'none';
        toast.offsetHeight;
        toast.style.display = 'flex';
    }

    sidebarActionOpenNewTab() { window.open(window.location.href, '_blank'); document.getElementById('sidebar-menu').style.display = 'none'; }

    sidebarActionMoveTo() {
        if (!this.contextPageId) {
            if (this.activePageId) this.contextPageId = this.activePageId;
            else return;
        }
        this.closeAllPopups();
        const rowEl = document.querySelector(`.sidebar-row[data-page-id="${this.contextPageId}"]`);
        // If triggered from top menu, rowEl might be null, handle positioning manually
        this.openMoveToMenu(this.contextPageId, rowEl);
    }

    openMoveToMenu(pageId, triggerEl) {
        this.pageToMoveId = pageId;
        const menu = document.getElementById('move-to-popup');
        const input = document.getElementById('move-search-input');

        input.value = '';
        this.renderMoveToCandidates();

        menu.style.display = 'flex';
        menu.style.position = 'fixed';

        if (triggerEl) {
            const rect = triggerEl.getBoundingClientRect();
            const left = rect.right - 20;
            let top = rect.top;
            const menuHeight = menu.offsetHeight || 300;
            const windowHeight = window.innerHeight;
            if (top + menuHeight > windowHeight - 10) top = windowHeight - menuHeight - 10;
            if (top < 10) top = 10;
            menu.style.left = left + 'px';
            menu.style.top = top + 'px';
        } else {
            // Center fallback
            menu.style.left = '50%';
            menu.style.top = '100px';
            menu.style.transform = 'translateX(-50%)';
        }

        input.focus();
        input.oninput = (e) => this.renderMoveToCandidates(e.target.value);
    }

    renderMoveToCandidates(query = '') {
        const list = document.getElementById('move-results-list');
        list.innerHTML = '';
        const q = query.toLowerCase();

        const currentPage = this.getPage(this.pageToMoveId);
        if (currentPage && currentPage.parentId !== null) {
            const rootItem = document.createElement('div');
            rootItem.className = 'move-item';
            rootItem.onclick = () => this.completeMove(null);
            rootItem.innerHTML = `
                <div class="move-nav-icon"><i data-lucide="chevron-right" class="icon-xs"></i></div>
                <div class="move-item-icon"><i data-lucide="corner-up-left" class="icon-sm"></i></div>
                <span class="truncate" style="flex:1;">Move to Private (Top Level)</span>
            `;
            list.appendChild(rootItem);
            lucide.createIcons();
        }

        const candidates = this.pages.filter(p => {
            if (p.id === this.pageToMoveId) return false;
            if (this.isDescendant(this.pageToMoveId, p.id)) return false;
            return (p.title || 'Untitled').toLowerCase().includes(q);
        });

        if (candidates.length === 0 && list.children.length === 0) {
            list.innerHTML = '<div style="padding:12px; color:var(--text-muted); font-size:12px;">No pages found</div>';
            return;
        }

        candidates.forEach(p => {
            const item = document.createElement('div');
            item.className = 'move-item';
            item.onclick = () => this.completeMove(p.id);
            item.innerHTML = `
                    <div class="move-nav-icon"><i data-lucide="chevron-right" class="icon-xs"></i></div>
                    <div class="move-item-icon">${p.icon || '📄'}</div>
                    <span class="truncate" style="flex:1;">${p.title || 'Untitled'}</span>
            `;
            list.appendChild(item);
        });
        lucide.createIcons();
    }

    isDescendant(parentId, childId) {
        if (parentId === childId) return true;
        const child = this.getPage(childId);
        if (!child || !child.parentId) return false;
        return this.isDescendant(parentId, child.parentId);
    }

    completeMove(targetPageId) {
        const page = this.getPage(this.pageToMoveId);
        if (page) {
            page.parentId = targetPageId;
            if (targetPageId !== null) {
                const target = this.getPage(targetPageId);
                if (target) target.sidebarCollapsed = false;
            }
            this.save();
            this.loadPage(this.pageToMoveId);
        }
        document.getElementById('move-to-popup').style.display = 'none';
    }


    // --- SIDE PEEK ---
    sidebarActionOpenSidePeek() {
        if (this.contextPageId) {
            document.getElementById('sidebar-menu').style.display = 'none';
            const page = this.getPage(this.contextPageId);
            this.renderSidePeek(page);
        }
    }

    renderSidePeek(page) {
        const peek = document.getElementById('side-peek');
        const body = document.getElementById('side-peek-body');

        let html = `<h2 style="margin-top:0">${page.icon} ${page.title}</h2>`;
        html += `<div style="color:var(--text-muted); font-size:12px; margin-bottom:20px;">Read-only preview</div>`;

        page.blocks.forEach(block => {
            let content = block.content || '';
            if (block.type === 'text') html += `<p>${content}</p>`;
            else if (block.type === 'h1') html += `<h1>${content}</h1>`;
            else if (block.type === 'h2') html += `<h2>${content}</h2>`;
            else if (block.type === 'h3') html += `<h3>${content}</h3>`;
            else if (block.type === 'bullet') html += `<li>${content}</li>`;
        });

        body.innerHTML = html;
        peek.classList.add('open');
    }

    closeSidePeek() { document.getElementById('side-peek').classList.remove('open'); }
    openSidePeekFull() {
        this.closeSidePeek();
    }

    duplicatePageRecursive(pageData, parentId) {
        const newId = 'page_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        const newPage = JSON.parse(JSON.stringify(pageData));
        newPage.id = newId; newPage.parentId = parentId; newPage.title = newPage.title + " (Copy)";
        this.pages.push(newPage);
        return newPage;
    }

    toggleSidebar() {
        this.sidebarOpen = !this.sidebarOpen;
        const sb = document.getElementById('sidebar');
        const btn = document.getElementById('sidebar-toggle-btn');
        if (this.sidebarOpen) { sb.style.marginLeft = '0'; btn.innerHTML = `<i data-lucide="menu" class="icon-sm"></i>`; }
        else { sb.style.marginLeft = `-${getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')}`; btn.innerHTML = `<i data-lucide="panel-left-open" class="icon-sm"></i>`; }
        lucide.createIcons();
    }

    addIcon() { this.getCurrentPage().icon = '💡'; this.save(); this.loadPage(this.activePageId); }
    randomizeIcon() {
        const icons = ['🍕', '🚀', '⭐', '🔥', '📚', '💡', '🎨', '💻', '🌊', '🌵'];
        this.getCurrentPage().icon = icons[Math.floor(Math.random() * icons.length)];
        this.save(); this.loadPage(this.activePageId);
    }
    toggleStyle(key) { const p = this.getCurrentPage(); p[key] = !p[key]; this.save(); this.loadPage(this.activePageId); }
    toggleFont(font) { const p = this.getCurrentPage(); p.font = font; this.save(); this.loadPage(this.activePageId); }
    lockPage() { const p = this.getCurrentPage(); p.locked = !p.locked; this.save(); this.loadPage(this.activePageId); }

    // --- Block Rendering ---
    createBlockElement(block) {
        const wrapper = document.createElement('div');
        wrapper.className = 'block-wrapper';
        wrapper.dataset.id = block.id;

        // **NEW: Block Handle (Six Dots) - renamed from block-menu-trigger**
        const handle = document.createElement('div');
        handle.className = 'block-handle';
        handle.innerHTML = `<i data-lucide="grip-vertical" class="icon-sm"></i>`;
        handle.setAttribute('draggable', 'true');
        handle.setAttribute('title', 'Drag to move\nClick or ctrl/ to open menu');
        handle.onclick = (e) => { e.stopPropagation(); this.openBlockMenu(e, block.id); };

        // **NEW: Plus Icon - Add block below (LEFT of six dots)**
        const plusIcon = document.createElement('div');
        plusIcon.className = 'block-plus-icon';
        plusIcon.innerHTML = `<i data-lucide="plus" class="icon-sm"></i>`;
        plusIcon.setAttribute('title', 'Click to add block below');
        plusIcon.onclick = (e) => { e.stopPropagation(); this.addBlockAfter(block.id); };

        // Drag events
        wrapper.addEventListener('dragover', (e) => this.handleDragOver(e, block.id));
        wrapper.addEventListener('dragleave', (e) => this.handleDragLeave(e, block.id));
        wrapper.addEventListener('drop', (e) => this.handleDrop(e, block.id));
        handle.addEventListener('dragstart', (e) => this.handleDragStart(e, block.id));

        wrapper.appendChild(plusIcon); // Plus on LEFT
        wrapper.appendChild(handle);   // Six dots on RIGHT
        const content = document.createElement('div');
        content.className = 'block-content';

        const isLocked = this.getCurrentPage().locked;
        const contentEditable = isLocked ? 'false' : 'true';

        // **NEW: Render blocks with proper HTML tags for headings**
        if (block.type === 'page') {
            const linkedPage = this.getPage(block.pageId);
            if (linkedPage) {
                const title = linkedPage.icon + ' ' + (linkedPage.title || 'Untitled');
                content.innerHTML = `<div class="block-page-link" onclick="app.loadPage('${block.pageId}')"><i data-lucide="file-text" class="icon-sm" style="color: var(--text-muted);"></i><span class="page-link-text">${title}</span></div>`;
            } else content.innerHTML = `<div style="color: var(--accent-red); padding: 8px;">[Deleted Page]</div>`;
            content.contentEditable = false;
        } else if (block.type === 'text') {
            content.innerHTML = `<div contenteditable="${contentEditable}" style="outline:none; padding: 2px 0;" placeholder="Type '/' for commands">${block.content}</div>`;
        } else if (block.type === 'h1') {
            content.innerHTML = `<h1 contenteditable="${contentEditable}" style="outline:none;" placeholder="Heading 1">${block.content}</h1>`;
        } else if (block.type === 'h2') {
            content.innerHTML = `<h2 contenteditable="${contentEditable}" style="outline:none;" placeholder="Heading 2">${block.content}</h2>`;
        } else if (block.type === 'h3') {
            content.innerHTML = `<h3 contenteditable="${contentEditable}" style="outline:none;" placeholder="Heading 3">${block.content}</h3>`;
        } else if (block.type === 'bullet') {
            content.innerHTML = `<div class="block-bullet"><div class="bullet-dot">•</div><div contenteditable="${contentEditable}" style="flex:1; outline:none;" placeholder="List item">${block.content}</div></div>`;
        } else if (block.type === 'todo') {
            const checked = block.checked ? 'checked' : '';
            const checkedClass = block.checked ? 'todo-checked' : '';
            content.innerHTML = `<div class="block-todo" data-type="todo"><input type="checkbox" class="todo-checkbox" ${checked} onchange="app.toggleTodo('${block.id}', this.checked)"><div contenteditable="${contentEditable}" class="${checkedClass}" style="flex:1; outline:none;" placeholder="To-do" oninput="app.updateTodoStyle(this, '${block.id}')">${block.content}</div></div>`;
        } else if (block.type === 'quote') {
            content.innerHTML = `<div contenteditable="${contentEditable}" class="block-quote" style="outline:none;" placeholder="Empty quote">${block.content}</div>`;
        } else if (block.type === 'callout') {
            content.innerHTML = `<div class="block-callout"><div class="callout-icon">💡</div><div contenteditable="${contentEditable}" style="flex:1; outline:none;" placeholder="Callout text...">${block.content}</div></div>`;
        } else if (block.type === 'divider') {
            content.className += ' block-divider';
            content.innerHTML = `<div class="divider-line"></div>`;
            content.contentEditable = false;
        } else if (block.type === 'table') {
            content.innerHTML = this.renderTable(block, contentEditable);
        } else if (block.type === 'image') {
            content.innerHTML = this.renderImageBlock(block);
            content.contentEditable = false;
        } else if (block.type === 'bookmark') {
            content.innerHTML = this.renderBookmarkBlock(block);
            content.contentEditable = false;
        } else if (block.type === 'code') {
            content.innerHTML = `<div class="block-code"><div class="code-lang">${block.language || 'Plain Text'}</div><pre><code contenteditable="${contentEditable}" style="outline:none; display:block;" spellcheck="false" placeholder="Write code here...">${block.content || ''}</code></pre></div>`;
        } else if (block.type === 'toggle') {
            const rotation = block.collapsed ? '' : 'rotated';
            const display = block.collapsed ? 'none' : 'block';
            content.innerHTML = `<div class="block-toggle"><div class="toggle-triangle ${rotation}" onclick="app.toggleToggleList('${block.id}')"><i data-lucide="play" class="icon-xs" style="fill: currentColor;"></i></div><div style="flex:1;"><div contenteditable="${contentEditable}" style="outline:none; font-weight: 500;" placeholder="Toggle header">${block.content}</div><div class="toggle-details" style="display:${display}" contenteditable="${contentEditable}" placeholder="Details..." oninput="app.updateToggleDetails(this, '${block.id}')">${block.details || ''}</div></div></div>`;
        }

        // **NEW: Improved input handling with slash menu detection**
        const editable = content.querySelector('[contenteditable="true"]');
        if (editable && !isLocked) {
            editable.onkeydown = (e) => this.handleBlockKeydown(e, block, editable);
            editable.oninput = (e) => this.handleBlockInput(e, block.id);
            editable.onfocus = () => this.activeBlockId = block.id;
        }

        wrapper.appendChild(content);
        return wrapper;
    }

    renderImageBlock(block) {
        if (block.url) return `<div class="img-block-wrapper"><img src="${block.url}"><input class="img-caption" value="${block.caption || ''}" placeholder="Write a caption..." oninput="app.updateImageCaption('${block.id}', this.value)"><button class="img-remove" onclick="app.removeImage('${block.id}')"><i data-lucide="x" class="icon-sm"></i></button></div>`;
        return `<div class="placeholder-box" onclick="app.triggerImageUpload('${block.id}')"><i data-lucide="image" class="icon-sm"></i><span>Add an image</span></div>`;
    }
    renderBookmarkBlock(block) {
        if (block.url) {
            let domain = ''; try { domain = new URL(block.url).hostname; } catch (e) { domain = block.url; }
            return `<div class="bookmark-card" onclick="window.open('${block.url}', '_blank')"><div class="bookmark-info"><div class="bookmark-title">${block.url}</div><div class="bookmark-desc">Web Bookmark</div><div class="bookmark-url"><i data-lucide="globe" class="icon-xs"></i> ${domain}</div></div><div class="bookmark-visual"><i data-lucide="link" style="width: 24px; height: 24px;"></i></div></div>`;
        }
        return `<div class="embed-input-row"><input type="text" class="embed-input" placeholder="Paste URL and hit Enter" onkeydown="app.handleBookmarkInput(event, '${block.id}', this)"><button class="embed-btn" onclick="app.handleBookmarkBtn('${block.id}', this.previousElementSibling)">Embed</button></div>`;
    }
    renderTable(block, contentEditable) {
        if (!block.data) block.data = [['Name', 'Tags'], ['', ''], ['', '']];
        let html = `<table class="simple-table"><thead><tr>`;
        const pointer = contentEditable === 'false' ? 'none' : 'auto';
        block.data[0].forEach((cell, i) => { html += `<th><input class="cell-input" style="font-weight:600; pointer-events:${pointer}" value="${cell}" oninput="app.updateTableCell('${block.id}', 0, ${i}, this.value)" ${contentEditable === 'false' ? 'readonly' : ''}></th>`; });
        if (contentEditable !== 'false') html += `<th style="width: 32px; text-align: center; cursor: pointer;" onclick="app.addColumn('${block.id}')">+</th>`;
        html += `</tr></thead><tbody>`;
        for (let r = 1; r < block.data.length; r++) {
            html += `<tr>`;
            block.data[r].forEach((cell, c) => { html += `<td><input class="cell-input" value="${cell}" oninput="app.updateTableCell('${block.id}', ${r}, ${c}, this.value)" style="pointer-events:${pointer}" ${contentEditable === 'false' ? 'readonly' : ''}></td>`; });
            if (contentEditable !== 'false') html += `<td></td>`;
            html += `</tr>`;
        }
        html += `</tbody></table>`;
        if (contentEditable !== 'false') html += `<div class="table-controls"><span class="control-link" onclick="app.addRow('${block.id}')">+ New Row</span></div>`;
        return html;
    }

    // --- Features ---
    triggerImageUpload(blockId) { this.pendingImageBlockId = blockId; document.getElementById('file-input').click(); }
    handleImageUpload(e) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => { const block = this.getCurrentPage().blocks.find(b => b.id === this.pendingImageBlockId); if (block) { block.url = ev.target.result; this.save(); this.loadPage(this.activePageId); } };
        reader.readAsDataURL(file); e.target.value = '';
    }
    updateImageCaption(blockId, val) { const block = this.getCurrentPage().blocks.find(b => b.id === blockId); if (block) { block.caption = val; this.save(); } }
    removeImage(blockId) { const block = this.getCurrentPage().blocks.find(b => b.id === blockId); if (block) { block.url = null; this.save(); this.loadPage(this.activePageId); } }
    handleBookmarkInput(e, blockId, input) { if (e.key === 'Enter') this.handleBookmarkBtn(blockId, input); }
    handleBookmarkBtn(blockId, input) { const url = input.value; if (!url) return; const block = this.getCurrentPage().blocks.find(b => b.id === blockId); if (block) { block.url = url; this.save(); this.loadPage(this.activePageId); } }
    toggleToggleList(blockId) { const block = this.getCurrentPage().blocks.find(b => b.id === blockId); if (block) { block.collapsed = !block.collapsed; this.save(); this.loadPage(this.activePageId); } }
    updateToggleDetails(el, blockId) { const block = this.getCurrentPage().blocks.find(b => b.id === blockId); if (block) { block.details = el.innerText; this.save(); } }

    setupGlobalEvents() {
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'k')) { e.preventDefault(); this.toggleSearch(); }
            if (e.key === 'Escape') {
                if (this.searchOpen) this.toggleSearch();
                this.closeAllPopups();
                if (document.getElementById('side-peek').classList.contains('open')) this.closeSidePeek();
            }
        });
        document.getElementById('search-input').addEventListener('input', (e) => this.handleSearchInput(e));
        document.getElementById('search-input').addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); this.navigateSearch('down'); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); this.navigateSearch('up'); }
            else if (e.key === 'Enter') {
                e.preventDefault();
                if (this.searchResults[this.searchSelectedIndex]) {
                    this.loadPage(this.searchResults[this.searchSelectedIndex].id); this.toggleSearch();
                }
            }
        });

        document.addEventListener('selectionchange', () => {
            const sel = window.getSelection();
            if (sel.rangeCount > 0 && document.getElementById('editor-container').contains(sel.anchorNode)) {
                this.lastRange = sel.getRangeAt(0);
                this.checkSelection();
            }
        });

        const sidebarBtns = document.querySelectorAll('.sidebar-menu-section .sidebar-btn');
        if (sidebarBtns[1]) sidebarBtns[1].onclick = () => alert("Updates feature coming soon!");
        if (sidebarBtns[2]) sidebarBtns[2].onclick = () => alert("Settings menu coming soon!");

        document.addEventListener('click', (e) => {
            if (e.target.id === 'search-overlay') this.toggleSearch();
            if (!e.target.closest('#slash-menu') && !e.target.closest('.block-wrapper')) this.closeSlashMenu();
            if (!e.target.closest('#block-menu') && !e.target.closest('.block-menu-trigger')) document.getElementById('block-menu').style.display = 'none';
            if (!e.target.closest('#sidebar-menu') && !e.target.closest('.action-btn')) document.getElementById('sidebar-menu').style.display = 'none';
            if (!e.target.closest('#move-to-popup') && !e.target.closest('.menu-item')) document.getElementById('move-to-popup').style.display = 'none';
            if (!e.target.closest('#section-menu') && !e.target.closest('.sidebar-header-action')) document.getElementById('section-menu').style.display = 'none';
            if (!e.target.closest('#side-peek') && !e.target.closest('.action-btn') && !e.target.closest('.menu-item')) this.closeSidePeek();

            if (!e.target.closest('#floating-toolbar') && !window.getSelection().toString()) {
                document.getElementById('floating-toolbar').classList.remove('visible');
            }

            const moreActionsMenu = document.getElementById('more-actions-menu');
            const moreActionsBtn = document.getElementById('more-actions-btn');
            // Improved check for closing top right menu
            if (moreActionsMenu.style.display === 'flex' && !moreActionsMenu.contains(e.target) && !moreActionsBtn.contains(e.target)) { moreActionsMenu.style.display = 'none'; }
        });
    }

    checkSelection() {
        const toolbar = document.getElementById('floating-toolbar');
        const selection = window.getSelection();
        if (selection.isCollapsed || !selection.rangeCount) {
            toolbar.classList.remove('visible'); setTimeout(() => { if (!toolbar.classList.contains('visible')) toolbar.style.display = 'none'; }, 200); return;
        }
        const range = selection.getRangeAt(0);
        if (!document.getElementById('editor-container').contains(range.commonAncestorContainer)) return;
        const rect = range.getBoundingClientRect();
        toolbar.style.display = 'flex'; void toolbar.offsetWidth; toolbar.classList.add('visible');
        toolbar.style.top = (rect.top + window.scrollY - 40) + 'px';
        toolbar.style.left = (rect.left + (rect.width / 2) - (toolbar.offsetWidth / 2)) + 'px';
    }

    formatText(type) {
        const selection = window.getSelection();
        let range = selection.rangeCount > 0 ? selection.getRangeAt(0) : this.lastRange;

        if (!range) return;
        if (range.collapsed) return;

        const tagMap = { 'bold': 'STRONG', 'italic': 'EM', 'underline': 'U', 'strikeThrough': 'S' };
        const tagName = tagMap[type];
        if (!tagName) return;

        try {
            const wrapper = document.createElement(tagName);
            const fragment = range.extractContents();
            wrapper.appendChild(fragment);
            range.insertNode(wrapper);

            selection.removeAllRanges();
            const newRange = document.createRange();
            newRange.selectNodeContents(wrapper);
            selection.addRange(newRange);

            this.lastRange = newRange;
            this.save();
        } catch (err) {
            console.error("Formatting failed:", err);
            document.execCommand(type, false, null);
        }
    }

    formatLink() { const url = prompt("Enter URL:", "https://"); if (url) document.execCommand('createLink', false, url); }
    updateTableCell(blockId, row, col, val) { const block = this.getCurrentPage().blocks.find(b => b.id === blockId); if (block) { block.data[row][col] = val; this.save(); } }
    addRow(blockId) { const block = this.getCurrentPage().blocks.find(b => b.id === blockId); const cols = block.data[0].length; block.data.push(new Array(cols).fill('')); this.save(); this.loadPage(this.activePageId); }
    addColumn(blockId) { const block = this.getCurrentPage().blocks.find(b => b.id === blockId); block.data.forEach(row => row.push('')); this.save(); this.loadPage(this.activePageId); }


    openBlockMenu(e, blockId) {
        e.stopPropagation();
        this.contextBlockId = blockId;

        const menu = document.getElementById('block-menu');

        // **FIX: Use fixed positioning with clientX/clientY**
        menu.style.display = 'flex';
        menu.style.position = 'fixed';

        // Get click position
        let top = e.clientY;
        let left = e.clientX;

        // Adjust if menu would go off screen
        setTimeout(() => {
            const menuRect = menu.getBoundingClientRect();
            const windowHeight = window.innerHeight;
            const windowWidth = window.innerWidth;

            // Adjust vertical position if needed
            if (top + menuRect.height > windowHeight - 10) {
                top = windowHeight - menuRect.height - 10;
            }

            // Adjust horizontal position if needed
            if (left + menuRect.width > windowWidth - 10) {
                left = windowWidth - menuRect.width - 10;
            }

            menu.style.top = top + 'px';
            menu.style.left = left + 'px';
        }, 0);

        // Initial positioning
        menu.style.top = top + 'px';
        menu.style.left = left + 'px';
    }
    deleteBlockMenuAction() { if (this.contextBlockId) this.deleteBlock(this.contextBlockId); document.getElementById('block-menu').style.display = 'none'; }
    duplicateBlockMenuAction() { const page = this.getCurrentPage(); const index = page.blocks.findIndex(b => b.id === this.contextBlockId); const original = page.blocks[index]; const copy = JSON.parse(JSON.stringify(original)); copy.id = 'block_' + Date.now(); page.blocks.splice(index + 1, 0, copy); this.save(); this.loadPage(this.activePageId); document.getElementById('block-menu').style.display = 'none'; }
    turnIntoMenuAction(type) {
        const block = this.getCurrentPage().blocks.find(b => b.id === this.contextBlockId);
        if (type === 'page') {
            const newPage = this.addPage(this.activePageId); newPage.title = block.content;
            block.type = 'page'; block.pageId = newPage.id; block.content = "Click to open sub-page";
        } else block.type = type;
        this.save(); this.loadPage(this.activePageId); document.getElementById('block-menu').style.display = 'none';
    }

    toggleTodo(id, checked) { const block = this.getCurrentPage().blocks.find(b => b.id === id); if (block) { block.checked = checked; this.save(); this.loadPage(this.activePageId); } }
    updateTodoStyle(el, id) { const block = this.getCurrentPage().blocks.find(b => b.id === id); block.content = el.innerText; this.save(); }

    handleBlockKeydown(e, block, el) {
        if (this.slashMenuOpen) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') { e.preventDefault(); this.navigateSlashMenu(e.key); return; }
            if (e.key === 'Escape') { this.closeSlashMenu(); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.addBlockAfter(block.id); }
        else if (e.key === 'Backspace' && el.innerText === '' && !this.slashMenuOpen) { e.preventDefault(); this.deleteBlock(block.id); }
    }

    addBlockAfter(prevId) {
        const page = this.getCurrentPage();
        const index = page.blocks.findIndex(b => b.id === prevId);
        const newBlock = { id: 'block_' + Date.now(), type: 'text', content: '' };
        page.blocks.splice(index + 1, 0, newBlock);
        this.save(); this.loadPage(this.activePageId);
        setTimeout(() => { const el = document.querySelector(`[data-id="${newBlock.id}"] [contenteditable]`); if (el) el.focus(); }, 0);
    }

    deleteBlock(id) {
        const page = this.getCurrentPage();
        const index = page.blocks.findIndex(b => b.id === id);
        if (index >= 0) {
            const block = page.blocks[index];
            if (block.type === 'page' && block.pageId) { if (!confirm('Deleting this block will move the sub-page to Trash. Continue?')) return; this.moveToTrash(block.pageId); }
            page.blocks.splice(index, 1);
            this.save(); this.loadPage(this.activePageId);
            if (index > 0) {
                const prevId = page.blocks[index - 1].id;
                setTimeout(() => {
                    const el = document.querySelector(`[data-id="${prevId}"] [contenteditable]`);
                    if (el) { el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
                }, 0);
            }
        }
    }

    focusLastBlock() {
        const page = this.getCurrentPage();
        if (page.blocks.length === 0) this.addBlockAfter(null);
        else {
            const lastBlock = page.blocks[page.blocks.length - 1];
            const el = document.querySelector(`[data-id="${lastBlock.id}"] [contenteditable]`);
            if (el) el.focus(); else this.addBlockAfter(lastBlock.id);
        }
    }


    handleDragStart(e, blockId) { this.draggedBlockId = blockId; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => document.querySelector(`[data-id="${blockId}"]`).classList.add('dragging'), 0); }
    handleDragOver(e, targetBlockId) {
        e.preventDefault(); if (targetBlockId === this.draggedBlockId) return;
        const targetEl = document.querySelector(`[data-id="${targetBlockId}"]`);
        const rect = targetEl.getBoundingClientRect();
        const offset = e.clientY - rect.top;
        targetEl.classList.remove('drag-over-top', 'drag-over-bottom');
        if (offset < rect.height / 2) targetEl.classList.add('drag-over-top'); else targetEl.classList.add('drag-over-bottom');
    }
    handleDragLeave(e, targetBlockId) { document.querySelector(`[data-id="${targetBlockId}"]`).classList.remove('drag-over-top', 'drag-over-bottom'); }
    handleDrop(e, targetBlockId) {
        e.preventDefault();
        document.querySelectorAll('.block-wrapper').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom', 'dragging'));
        if (this.draggedBlockId === targetBlockId) return;
        const targetEl = document.querySelector(`[data-id="${targetBlockId}"]`);
        const rect = targetEl.getBoundingClientRect();
        const position = (e.clientY - rect.top) < (rect.height / 2) ? 'before' : 'after';
        this.reorderBlocks(this.draggedBlockId, targetBlockId, position);
    }
    reorderBlocks(srcId, targetId, position) {
        const page = this.getCurrentPage();
        const srcIndex = page.blocks.findIndex(b => b.id === srcId);
        const [movedBlock] = page.blocks.splice(srcIndex, 1);
        let targetIndex = page.blocks.findIndex(b => b.id === targetId);
        if (position === 'after') targetIndex++;
        page.blocks.splice(targetIndex, 0, movedBlock);
        this.save(); this.loadPage(this.activePageId);
    }

    // **NEW: Block System Helper Methods**

    // **NEW: Menu Helper Methods**
    toggleSubmenu(type) {
        console.log('Toggle submenu:', type);
        // Placeholder for submenu logic
    }

    moveBlockToPage() {
        const targetTitle = prompt("Enter the exact title of the page to move this block to:");
        if (!targetTitle) return;

        // Find target page (DFS search ideally, but flat search for now)
        const findPage = (pages) => {
            for (const p of pages) {
                if (p.title === targetTitle) return p;
                if (p.children) {
                    const found = findPage(p.children);
                    if (found) return found; // Assumes children structure if it exists, otherwise flat
                }
            }
            return null;
        };

        // Simple search in flat pages array or recursive if needed. 
        // Based on constructor, this.pages is the root array.
        // We'll search top level for now or specific structure.

        let targetPage = this.pages.find(p => p.title === targetTitle);
        // If not found in root, maybe we need deep search.
        // Assuming flat structure for simple pages or standard array.

        if (!targetPage && this.pages.length > 0) {
            // Try searching all pages if flat list doesn't work or if structure is complex
            // For now, let's assume flat or root level. 
            // If nested pages are stored differently, we'd need that logic.
        }

        if (targetPage) {
            const currentPage = this.getCurrentPage();
            const blockIndex = currentPage.blocks.findIndex(b => b.id === this.contextBlockId);

            if (blockIndex > -1) {
                const [block] = currentPage.blocks.splice(blockIndex, 1);
                targetPage.blocks.push(block);
                this.save();
                this.loadPage(this.activePageId);
                this.showToast(`Block moved to "${targetTitle}"`);
            }
        } else {
            alert("Page not found. Please enter an exact existing page title.");
        }
        document.getElementById('block-menu').style.display = 'none';
    }

    copyLinkToBlock() {
        const url = window.location.href.split('#')[0] + '#' + this.contextBlockId;
        // Basic copy to clipboard
        const input = document.createElement('textarea');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);

        this.showToast('Link copied to clipboard');
        document.getElementById('block-menu').style.display = 'none';
    }

    /**
     * Generate unique ID for blocks
     */


    turnBlockInto(id, type) {
        const page = this.getCurrentPage();
        const block = page.blocks.find(b => b.id === id);
        if (!block) return;

        block.type = type;
        // Strip the slash command from content reliably (e.g. "/h1 Hello" -> "Hello")
        block.content = block.content.replace(/^\/[a-zA-Z0-9-]*\s?/, '');

        if (type === 'page') {
            // handle page conversion if needed (create subpage)
            const newPage = this.addPage(page.id);
            newPage.title = block.content;
            block.pageId = newPage.id;
            block.content = ''; // Clear content for page block wrapper
            this.save();
        }

        this.save();
        this.loadPage(this.activePageId);
        // Focus the block after conversion
        setTimeout(() => {
            const el = document.querySelector(`.block-wrapper[data-id="${id}"] [contenteditable]`);
            if (el) {
                el.focus();
                // Place cursor at end
                const range = document.createRange();
                range.selectNodeContents(el);
                range.collapse(false);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }, 10);
    }

    handleBlockInput(e, id) {
        if (e.inputType === 'insertParagraph') {
            e.preventDefault();
            this.addBlockAfter(id);
            return;
        }

        const el = e.target;
        const page = this.getCurrentPage();
        const block = page.blocks.find(b => b.id === id);
        if (block) {
            const text = el.innerText;
            block.content = text;

            // Trigger Slash Menu
            if (text.startsWith('/')) {
                const query = text.substring(1).toLowerCase();
                this.openSlashMenu(id, query);
            } else {
                this.closeSlashMenu();
            }
            this.save();
        }
    }

    openSlashMenu(blockId, query = '') {
        this.activeBlockIdForMenu = blockId;
        this.slashMenuOpen = true;
        const menu = document.getElementById('slash-command-menu');
        if (!menu) return;

        // Filter Items (Simple inline filtering)
        const items = menu.querySelectorAll('.menu-item');
        let hasVisible = false;
        let firstVisibleIndex = -1;
        const q = query.toLowerCase();
        const qClean = q.replace(/[^a-z0-9]/g, '');

        items.forEach((item, index) => {
            const label = item.querySelector('.menu-item-text span').innerText.toLowerCase();
            const labelClean = label.replace(/[^a-z0-9]/g, '');
            const type = (item.getAttribute('data-type') || '').toLowerCase();
            const typeClean = type.replace(/[^a-z0-9]/g, '');
            const onMouseDownAttr = (item.getAttribute('onmousedown') || '').toLowerCase();

            // Match if: original label/type contains query OR clean label/type contains clean query
            const matches = label.includes(q) || type.includes(q) ||
                (qClean.length > 0 && (labelClean.includes(qClean) || typeClean.includes(qClean))) ||
                onMouseDownAttr.includes(q);

            if (matches) {
                item.style.display = 'flex';
                hasVisible = true;
                if (firstVisibleIndex === -1) firstVisibleIndex = index;
            } else {
                item.style.display = 'none';
                item.classList.remove('active');
            }
        });

        if (!hasVisible && query.length > 0) {
            this.closeSlashMenu();
            return;
        }

        // Highlight first item
        this.slashMenuIndex = firstVisibleIndex;
        this.highlightSlashMenuItem();

        // Position Logic
        const blockEl = document.querySelector(`.block-wrapper[data-id="${blockId}"]`);
        if (blockEl) {
            const rect = blockEl.getBoundingClientRect();
            menu.style.display = 'flex';
            menu.style.top = (rect.bottom + 5) + 'px';
            menu.style.left = rect.left + 'px';
        }
    }

    navigateSlashMenu(key) {
        const menu = document.getElementById('slash-command-menu');
        const items = Array.from(menu.querySelectorAll('.menu-item'));
        const visibleItems = items.filter(item => item.style.display !== 'none');

        if (visibleItems.length === 0) return;

        let currentIndexInVisible = visibleItems.indexOf(items[this.slashMenuIndex]);

        if (key === 'ArrowDown') {
            currentIndexInVisible = (currentIndexInVisible + 1) % visibleItems.length;
        } else if (key === 'ArrowUp') {
            currentIndexInVisible = (currentIndexInVisible - 1 + visibleItems.length) % visibleItems.length;
        } else if (key === 'Enter') {
            const item = visibleItems[currentIndexInVisible];
            item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            return;
        }

        this.slashMenuIndex = items.indexOf(visibleItems[currentIndexInVisible]);
        this.highlightSlashMenuItem();
    }

    highlightSlashMenuItem() {
        const menu = document.getElementById('slash-command-menu');
        menu.querySelectorAll('.menu-item').forEach((item, index) => {
            if (index === this.slashMenuIndex) {
                item.classList.add('active');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('active');
            }
        });
    }

    closeSlashMenu() {
        this.slashMenuOpen = false;
        const menu = document.getElementById('slash-command-menu');
        if (menu) menu.style.display = 'none';
        this.activeBlockIdForMenu = null;
    }

    generateId() {
        return 'block_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
}

const app = new NotionApp();
window.app = app;  // Expose to window for global access/debugging
