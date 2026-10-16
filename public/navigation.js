const initialized = new WeakMap();

// Query ordering does not change which navigation destination is current.
export function isCurrentNavigationLink(href, currentHref) {
  try {
    const current = new URL(currentHref), destination = new URL(href, current);
    const query = url => JSON.stringify([...url.searchParams].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)));
    return destination.origin === current.origin && destination.pathname === current.pathname && query(destination) === query(current);
  } catch {
    return false;
  }
}

export function initSiteNavigation(root = document) {
  const document = root.ownerDocument || root;
  const window = document.defaultView;
  const navigation = root.querySelector('#site-navigation');
  const drawer = root.querySelector('#sections-menu');
  const toggle = root.querySelector('#mobile-menu-toggle');
  if (!navigation || !drawer || !window) return () => {};
  if (initialized.has(drawer)) return initialized.get(drawer);

  const closeButton = drawer.querySelector('#mobile-menu-close');
  const backdrop = root.querySelector('#mobile-menu-backdrop');
  const media = window.matchMedia('(max-width:760px)');
  const hover = window.matchMedia('(hover:hover) and (pointer:fine)');
  const controller = new AbortController();
  const listenerOptions = {signal: controller.signal};
  const groups = [...navigation.querySelectorAll('.nav-group')].map(group => {
    const trigger = group.querySelector('.nav-expand');
    const panel = document.getElementById(trigger?.getAttribute('aria-controls')) || group.querySelector('.nav-submenu');
    return {group, trigger, panel};
  }).filter(entry => entry.trigger && entry.panel && entry.group.contains(entry.panel));
  let drawerOpen = false;
  let pointerGroup = null;
  let focusCloseTimer;

  const visibleControls = container => [...container.querySelectorAll('a[href],button:not([disabled]),summary,input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]')]
    .filter(element => {
      const explicitTabIndex = element.getAttribute('tabindex');
      if (explicitTabIndex !== null && Number(explicitTabIndex) < 0) return false;
      const operativeSummary = element.tagName === 'SUMMARY' && element.parentElement?.tagName === 'DETAILS'
        && [...element.parentElement.children].find(child => child.tagName === 'SUMMARY') === element;
      if (element.tabIndex < 0 && !(operativeSummary && explicitTabIndex === null)) return false;
      for (let details = element.parentElement?.closest('details:not([open])'); details; details = details.parentElement?.closest('details:not([open])')) {
        const summary = [...details.children].find(child => child.tagName === 'SUMMARY');
        if (!summary?.contains(element)) return false;
      }
      return !element.closest('[hidden],[inert]') && element.getClientRects().length && window.getComputedStyle(element).visibility !== 'hidden';
    });

  function setGroup(entry, open) {
    entry.group.classList.toggle('open', open);
    entry.trigger.setAttribute('aria-expanded', String(open));
    entry.panel.hidden = !open;
    if (!open) entry.hoverOpened = false;
  }

  function closeGroups() {
    groups.forEach(entry => setGroup(entry, false));
  }

  function dismissGroups() {
    const focusedGroup = groups.find(entry => entry.panel.contains(document.activeElement));
    closeGroups();
    focusedGroup?.trigger.focus();
  }

  function openGroup(entry, focusFirst = false) {
    groups.forEach(other => setGroup(other, other === entry));
    if (focusFirst) visibleControls(entry.panel)[0]?.focus();
  }

  function markCurrentLinks() {
    root.querySelectorAll('#site-navigation .nav-submenu a[href],#sections-menu a[href]').forEach(link => {
      const current = isCurrentNavigationLink(link.getAttribute('href'), window.location.href);
      link.classList.toggle('active', current);
      if (current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function setDrawer(open, returnFocus = false) {
    drawerOpen = open;
    document.body.classList.toggle('drawer-visible', drawerOpen);
    drawer.hidden = !drawerOpen;
    if (backdrop) backdrop.hidden = !drawerOpen;
    toggle?.setAttribute('aria-expanded', String(drawerOpen));
    toggle?.setAttribute('aria-label', drawerOpen ? 'إغلاق القائمة' : 'فتح القائمة');
    if ('inert' in drawer) drawer.inert = !drawerOpen;
    drawer.setAttribute('aria-hidden', String(!drawerOpen));
    if (drawerOpen) {
      closeGroups();
      drawer.querySelectorAll('details').forEach(group => { group.open = group.hasAttribute('data-default-open'); });
      drawer.scrollTop = 0;
      (closeButton || visibleControls(drawer)[0])?.focus({preventScroll: true});
    } else {
      if (returnFocus) toggle?.focus();
    }
  }

  groups.forEach(entry => {
    entry.trigger.addEventListener('click', () => {
      if (entry.hoverOpened) { entry.hoverOpened = false; openGroup(entry); }
      else if (entry.trigger.getAttribute('aria-expanded') === 'true') setGroup(entry, false);
      else openGroup(entry);
    }, listenerOptions);
    entry.group.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' || ![entry.trigger, entry.group.querySelector('[data-nav]')].includes(event.target)) return;
      event.preventDefault();
      openGroup(entry, true);
    }, listenerOptions);
    entry.group.addEventListener('focusout', event => {
      if (media.matches || entry.group.contains(event.relatedTarget)) return;
      window.clearTimeout(focusCloseTimer);
      focusCloseTimer = window.setTimeout(() => {
        if (!media.matches && pointerGroup !== entry && !entry.group.contains(document.activeElement)) setGroup(entry, false);
      }, 0);
    }, listenerOptions);
    entry.group.addEventListener('pointerenter', event => {
      if (groups.some(other => other !== entry && other.panel.contains(document.activeElement))) return;
      if (!drawerOpen && !media.matches && hover.matches && event.pointerType !== 'touch' && entry.trigger.getAttribute('aria-expanded') !== 'true') {
        openGroup(entry);
        entry.hoverOpened = true;
      }
    }, listenerOptions);
    entry.group.addEventListener('pointerleave', () => {
      if (!drawerOpen && !media.matches && hover.matches && !entry.group.contains(document.activeElement)) setGroup(entry, false);
    }, listenerOptions);
  });

  toggle?.addEventListener('click', () => setDrawer(!drawerOpen, drawerOpen), listenerOptions);
  closeButton?.addEventListener('click', () => setDrawer(false, true), listenerOptions);
  backdrop?.addEventListener('click', () => setDrawer(false, true), listenerOptions);
  navigation.addEventListener('click', event => {
    if (!event.target.closest('a[href]')) return;
    closeGroups();
  }, listenerOptions);
  drawer.addEventListener('click', event => {
    if (event.target.closest('a[href]')) setDrawer(false, true);
  }, listenerOptions);

  document.addEventListener('pointerdown', event => {
    pointerGroup = groups.find(entry => entry.group.contains(event.target)) || null;
  }, listenerOptions);
  document.addEventListener('pointerup', () => { pointerGroup = null; }, listenerOptions);
  document.addEventListener('pointercancel', () => { pointerGroup = null; }, listenerOptions);
  document.addEventListener('click', event => {
    if (drawer.contains(event.target) || toggle?.contains(event.target)) return;
    if (drawerOpen) setDrawer(false, true);
    if (!navigation.contains(event.target)) dismissGroups();
  }, listenerOptions);
  document.addEventListener('keydown', event => {
    pointerGroup = null;
    if (event.key === 'Escape') {
      if (drawerOpen) {
        event.preventDefault();
        setDrawer(false, true);
      } else {
        const open = groups.find(entry => entry.trigger.getAttribute('aria-expanded') === 'true');
        if (!open) return;
        event.preventDefault();
        closeGroups();
        open.trigger.focus();
      }
      return;
    }
    if (event.key !== 'Tab' || !drawerOpen) return;
    const controls = visibleControls(drawer);
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    const outside = !drawer.contains(document.activeElement);
    if (event.shiftKey && (document.activeElement === first || outside)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || outside)) {
      event.preventDefault(); first.focus();
    }
  }, listenerOptions);

  document.addEventListener('focusin', event => {
    if (drawerOpen && !drawer.contains(event.target)) (closeButton || visibleControls(drawer)[0])?.focus();
  }, listenerOptions);
  media.addEventListener('change', () => {
    const focused = document.activeElement;
    const focusedGroup = groups.find(entry => entry.panel.contains(focused));
    closeGroups();
    if (!drawerOpen && media.matches && navigation.contains(focused)) toggle?.focus();
    else if (!drawerOpen && focusedGroup) focusedGroup.trigger.focus();
  }, listenerOptions);
  window.addEventListener('blur', () => { if (!drawerOpen && !media.matches) dismissGroups(); }, listenerOptions);
  window.addEventListener('hashchange', markCurrentLinks, listenerOptions);
  window.addEventListener('popstate', markCurrentLinks, listenerOptions);

  markCurrentLinks();
  closeGroups();
  setDrawer(false);
  const cleanup = () => {
    controller.abort();
    window.clearTimeout(focusCloseTimer);
    closeGroups();
    setDrawer(false);
    initialized.delete(drawer);
  };
  initialized.set(drawer, cleanup);
  return cleanup;
}
