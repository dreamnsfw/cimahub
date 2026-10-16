const root = document.querySelector('#app');
const notifications = document.querySelector('#notifications');

const icons = {
  film: ['M4 3h16v18H4z', 'M4 8h16M4 16h16M8 3v5m8-5v5M8 16v5m8-5v5'],
  grid: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  play: ['M8 4l13 8-13 8z'],
  link: ['M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2', 'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'],
  tags: ['M3 3h8l10 10-8 8L3 11z', 'M7 7h.01'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2'],
  refresh: ['M20 7a9 9 0 0 0-15-2L2 8m0-6v6h6', 'M4 17a9 9 0 0 0 15 2l3-3m0 6v-6h-6'],
  anime: ['M12 2l3 6 7 1-5 5 1 8-6-3-6 3 1-8-5-5 7-1z'],
  user: ['M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M4 21v-3a8 6 0 0 1 16 0v3'],
  logout: ['M9 4H4v16h5', 'M9 12h13m-4-4 4 4-4 4'],
  close: ['M6 6l12 12M18 6 6 18'],
  check: ['M4 12l5 5L20 6'],
  alert: ['M12 3 2 21h20z', 'M12 9v5m0 3h.01']
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of icons[name] || icons.film) {
    const p = document.createElementNS(svg.namespaceURI, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = Boolean(value);
    else if (key === 'value') node.value = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child != null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const state = {
  user: null,
  csrf: '',
  active: 'dashboard',
  contentFilters: { q: '', type: '', status: '', page: 1 },
  sourceKey: ''
};

function notify(message, error = false) {
  const box = el('div', { class: `toast${error ? ' error' : ''}`, role: error ? 'alert' : 'status' },
    icon(error ? 'alert' : 'check'),
    el('span', { text: message }),
    el('button', { class: 'toast-close', type: 'button', onClick: () => box.remove() }, icon('close'))
  );
  notifications.append(box);
  setTimeout(() => box.remove(), error ? 8000 : 4000);
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method) && state.csrf) headers['X-CSRF-Token'] = state.csrf;
  const res = await fetch(`/api/admin${path}`, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.user) {
      state.user = null;
      render();
    }
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

const routes = [
  ['dashboard', 'Overview', 'grid', 'Workspace'],
  ['content', 'All content', 'grid', 'Library'],
  ['movies', 'Movies', 'film', 'Library'],
  ['series', 'Series', 'play', 'Library'],
  ['anime', 'Anime', 'anime', 'Library'],
  ['sources', 'Sources', 'link', 'Library'],
  ['taxonomy', 'Categories', 'tags', 'Site management'],
  ['settings', 'Settings', 'settings', 'Site management'],
  ['jobs', 'Sync jobs', 'refresh', 'Site management'],
  ['users', 'Users', 'user', 'Administration'],
  ['account', 'My account', 'user', 'Administration']
];

function renderLogin() {
  root.innerHTML = '';
  const form = el('form', {
    class: 'auth-card',
    onSubmit: async e => {
      e.preventDefault();
      const email = form.email.value.trim();
      const password = form.password.value;
      try {
        const res = await api('/login', { method: 'POST', body: { email, password } });
        state.user = res.user;
        state.csrf = res.csrf;
        notify('Signed in successfully');
        render();
      } catch (err) {
        notify(err.message, true);
      }
    }
  },
    el('div', { class: 'auth-brand' },
      el('span', { text: 'CimaHub' }),
      el('span', { class: 'brand-badge', text: 'Admin' })
    ),
    el('h2', { style: 'font-size:18px; margin-bottom:6px;', text: 'Sign in to admin panel' }),
    el('p', { style: 'font-size:13px; color:var(--text-muted); margin-bottom:20px;', text: 'Enter your administrator credentials to proceed.' }),
    el('div', { class: 'form-field' },
      el('label', { text: 'Email address' }),
      el('input', { type: 'email', name: 'email', required: true, autofocus: true })
    ),
    el('div', { class: 'form-field' },
      el('label', { text: 'Password' }),
      el('input', { type: 'password', name: 'password', required: true })
    ),
    el('button', { type: 'submit', class: 'btn primary', style: 'width:100%; margin-top:12px;', text: 'Sign in' })
  );

  root.append(el('div', { class: 'auth-container' }, form));
}

function render() {
  if (!state.user) {
    renderLogin();
    return;
  }

  root.innerHTML = '';

  // Shell Layout
  const shell = el('div', { class: 'app-shell' });
  const sidebar = el('aside', { class: 'app-sidebar' },
    el('div', { class: 'sidebar-header' },
      el('div', { style: 'display:flex; align-items:center; gap:8px; font-weight:700;' },
        el('span', { style: 'color:var(--primary);', text: '▶' }),
        el('span', { text: 'CimaHub' }),
        el('span', { class: 'badge draft', text: 'Admin' })
      )
    ),
    el('nav', { class: 'sidebar-nav' })
  );

  // Group routes in sidebar
  let currentGroup = '';
  const nav = sidebar.querySelector('.sidebar-nav');
  for (const [id, label, iconName, group] of routes) {
    if (group !== currentGroup) {
      currentGroup = group;
      nav.append(el('div', { class: 'nav-group-title', text: group }));
    }
    const item = el('button', {
      type: 'button',
      class: `nav-item${state.active === id ? ' active' : ''}`,
      onClick: () => {
        state.active = id;
        render();
      }
    }, icon(iconName), el('span', { text: label }));
    nav.append(item);
  }

  // Sidebar footer
  sidebar.append(el('div', { class: 'sidebar-footer' },
    el('div', { class: 'user-info' },
      el('div', { style: 'font-weight:600; color:var(--text);', text: state.user.email }),
      el('div', { style: 'font-size:11px;', text: state.user.role })
    ),
    el('button', {
      type: 'button',
      class: 'btn ghost small',
      title: 'Sign out',
      onClick: async () => {
        try {
          await api('/logout', { method: 'POST' });
        } catch {}
        state.user = null;
        render();
      }
    }, icon('logout'))
  ));

  // Main area
  const main = el('main', { class: 'app-main' },
    el('header', { class: 'main-header' },
      el('h1', { style: 'font-size:18px; font-weight:600;', text: routes.find(r => r[0] === state.active)?.[1] || 'Dashboard' }),
      el('div', { style: 'display:flex; gap:12px;' },
        el('a', { href: '/', target: '_blank', class: 'btn small ghost', text: 'Open site ↗' })
      )
    ),
    el('div', { class: 'main-body' })
  );

  shell.append(sidebar, main);
  root.append(shell);

  const body = main.querySelector('.main-body');
  loadView(state.active, body);
}

async function loadView(route, container) {
  container.innerHTML = '<div class="boot-state"><span class="spinner"></span><p>Loading view…</p></div>';

  if (route === 'dashboard') {
    try {
      const data = await api('/dashboard');
      const c = data.counts || {};
      container.innerHTML = '';
      container.append(
        el('div', { class: 'stats-row' },
          el('div', { class: 'stat-box' }, el('div', { class: 'title', text: 'Total Movies' }), el('div', { class: 'value', text: (c.movies || 0).toLocaleString() })),
          el('div', { class: 'stat-box' }, el('div', { class: 'title', text: 'Total Series' }), el('div', { class: 'value', text: (c.series || 0).toLocaleString() })),
          el('div', { class: 'stat-box' }, el('div', { class: 'title', text: 'Anime Library' }), el('div', { class: 'value', text: (c.anime || 0).toLocaleString() })),
          el('div', { class: 'stat-box' }, el('div', { class: 'title', text: 'Sources & Streams' }), el('div', { class: 'value', text: (c.sources || 0).toLocaleString() })),
          el('div', { class: 'stat-box' }, el('div', { class: 'title', text: 'Database Engine' }), el('div', { class: 'value', style: 'color:var(--green-text); font-size:20px;', text: data.database || 'PostgreSQL' }))
        )
      );
    } catch (err) {
      container.innerHTML = `<div class="toast error">${err.message}</div>`;
    }
  } else if (['content', 'movies', 'series', 'anime'].includes(route)) {
    loadContentView(route, container);
  } else if (route === 'sources') {
    loadSourcesView(container);
  } else if (route === 'taxonomy') {
    loadTaxonomyView(container);
  } else if (route === 'settings') {
    loadSettingsView(container);
  } else if (route === 'jobs') {
    loadJobsView(container);
  } else if (route === 'users') {
    loadUsersView(container);
  } else if (route === 'account') {
    loadAccountView(container);
  }
}

async function loadContentView(section, container) {
  const typeFilter = section === 'movies' ? 'movie' : section === 'series' ? 'tv' : section === 'anime' ? 'anime' : '';
  container.innerHTML = '';

  const toolbar = el('div', { class: 'toolbar' },
    el('input', {
      type: 'text',
      class: 'input-control',
      placeholder: 'Search by title, ID or slug…',
      style: 'flex:1; min-width:240px;',
      value: state.contentFilters.q,
      onKeydown: e => { if (e.key === 'Enter') { state.contentFilters.q = e.target.value; fetchItems(); } }
    }),
    el('select', {
      class: 'input-control',
      onChange: e => { state.contentFilters.status = e.target.value; fetchItems(); }
    },
      el('option', { value: '', text: 'All statuses' }),
      el('option', { value: 'published', text: 'Published' }),
      el('option', { value: 'draft', text: 'Draft' }),
      el('option', { value: 'hidden', text: 'Hidden' })
    ),
    el('button', {
      class: 'btn primary',
      type: 'button',
      onClick: () => openImportModal(() => fetchItems())
    }, icon('film'), el('span', { text: 'Import from TMDB' }))
  );

  const tablePanel = el('div', { class: 'table-panel' });
  container.append(toolbar, tablePanel);

  async function fetchItems() {
    tablePanel.innerHTML = '<div style="padding:40px; text-align:center;"><span class="spinner"></span></div>';
    try {
      const q = new URLSearchParams({
        page: state.contentFilters.page,
        q: state.contentFilters.q,
        type: typeFilter,
        status: state.contentFilters.status
      });
      const data = await api(`/content?${q}`);
      tablePanel.innerHTML = '';

      if (!data.items?.length) {
        tablePanel.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted);">No records found.</div>';
        return;
      }

      const table = el('table', { class: 'data-table' },
        el('thead', {},
          el('tr', {},
            el('th', { style: 'width:60px;', text: 'Cover' }),
            el('th', { text: 'Title' }),
            el('th', { text: 'Type' }),
            el('th', { text: 'Year' }),
            el('th', { text: 'Status' }),
            el('th', { style: 'text-align:right;', text: 'Actions' })
          )
        ),
        el('tbody', {},
          data.items.map(item => {
            const kind = item.is_anime ? 'Anime' : item.kind === 'tv' ? 'Series' : 'Movie';
            const poster = item.snapshot?.poster_path ? `https://image.tmdb.org/t/p/w92${item.snapshot.poster_path}` : '';
            return el('tr', {},
              el('td', {}, poster ? el('img', { src: poster, style: 'width:38px; height:54px; object-fit:cover; border-radius:4px; background:#20242c;' }) : el('div', { style: 'width:38px; height:54px; background:#20242c; border-radius:4px;' })),
              el('td', {}, el('div', { style: 'font-weight:600;', text: item.name }), el('div', { style: 'font-size:11px; color:var(--text-muted);', text: item.key })),
              el('td', { text: kind }),
              el('td', { text: item.year || '-' }),
              el('td', {}, el('span', { class: `badge ${item.status}`, text: item.status })),
              el('td', { style: 'text-align:right;' },
                el('button', { class: 'btn small', onClick: () => openEditModal(item.key, () => fetchItems()), text: 'Edit' }),
                el('button', {
                  class: 'btn small',
                  style: 'margin-left:6px;',
                  onClick: () => {
                    state.sourceKey = item.key;
                    state.active = 'sources';
                    render();
                  },
                  text: 'Sources'
                }),
                item.slug ? el('a', { href: `/${item.slug}/`, target: '_blank', class: 'btn small ghost', style: 'margin-left:6px;', text: 'View ↗' }) : false
              )
            );
          })
        )
      );
      tablePanel.append(table);
    } catch (err) {
      tablePanel.innerHTML = `<div class="toast error">${err.message}</div>`;
    }
  }

  fetchItems();
}

function openImportModal(onDone) {
  const modal = el('div', { class: 'modal-layer' },
    el('div', { class: 'modal-window' },
      el('div', { class: 'modal-header' },
        el('h3', { text: 'Import content from TMDB' }),
        el('button', { class: 'toast-close', onClick: () => modal.remove() }, icon('close'))
      ),
      el('form', {
        onSubmit: async e => {
          e.preventDefault();
          const type = e.target.type.value;
          const tmdbId = e.target.tmdbId.value;
          try {
            await api('/content', { method: 'POST', body: { type, tmdbId } });
            notify('Imported successfully');
            modal.remove();
            onDone();
          } catch (err) {
            notify(err.message, true);
          }
        }
      },
        el('div', { class: 'form-field' },
          el('label', { text: 'Type' }),
          el('select', { name: 'type' },
            el('option', { value: 'movie', text: 'Movie' }),
            el('option', { value: 'tv', text: 'TV Series' })
          )
        ),
        el('div', { class: 'form-field' },
          el('label', { text: 'TMDB ID' }),
          el('input', { type: 'number', name: 'tmdbId', required: true, placeholder: 'e.g. 550' })
        ),
        el('div', { style: 'display:flex; justify-content:flex-end; gap:8px; margin-top:20px;' },
          el('button', { type: 'button', class: 'btn', onClick: () => modal.remove(), text: 'Cancel' }),
          el('button', { type: 'submit', class: 'btn primary', text: 'Import' })
        )
      )
    )
  );
  document.body.append(modal);
}

async function openEditModal(key, onDone) {
  try {
    const data = await api(`/content/${key}`);
    const item = data.item;
    const modal = el('div', { class: 'modal-layer' },
      el('div', { class: 'modal-window' },
        el('div', { class: 'modal-header' },
          el('h3', { text: `Edit: ${item.name}` }),
          el('button', { class: 'toast-close', onClick: () => modal.remove() }, icon('close'))
        ),
        el('form', {
          onSubmit: async e => {
            e.preventDefault();
            const body = {
              name: e.target.name.value.trim(),
              overview: e.target.overview.value.trim(),
              status: e.target.status.value,
              adult_category: e.target.adult_category.checked
            };
            if (e.target.poster_path.value) body.poster_path = e.target.poster_path.value.trim();
            try {
              await api(`/content/${key}`, { method: 'PATCH', body });
              notify('Updated successfully');
              modal.remove();
              onDone();
            } catch (err) {
              notify(err.message, true);
            }
          }
        },
          el('div', { class: 'form-field' },
            el('label', { text: 'Title' }),
            el('input', { type: 'text', name: 'name', value: item.name || '', required: true })
          ),
          el('div', { class: 'form-field' },
            el('label', { text: 'Overview / Synopsis' }),
            el('textarea', { name: 'overview', rows: 4, value: item.overrides?.overview ?? item.snapshot?.overview ?? '' })
          ),
          el('div', { class: 'form-field' },
            el('label', { text: 'Poster image path' }),
            el('input', { type: 'text', name: 'poster_path', value: item.overrides?.poster_path ?? item.snapshot?.poster_path ?? '' })
          ),
          el('div', { class: 'form-field' },
            el('label', { text: 'Publication status' }),
            el('select', { name: 'status' },
              el('option', { value: 'published', selected: item.status === 'published', text: 'Published' }),
              el('option', { value: 'draft', selected: item.status === 'draft', text: 'Draft' }),
              el('option', { value: 'hidden', selected: item.status === 'hidden', text: 'Hidden' })
            )
          ),
          el('div', { class: 'form-field', style: 'display:flex; align-items:center; gap:8px;' },
            el('input', { type: 'checkbox', name: 'adult_category', id: 'adult_cat', checked: Boolean(item.overrides?.adult_category ?? item.snapshot?.adult) }),
            el('label', { for: 'adult_cat', style: 'margin:0; cursor:pointer;', text: '18+ Adult category' })
          ),
          el('div', { style: 'display:flex; justify-content:flex-end; gap:8px; margin-top:20px;' },
            el('button', { type: 'button', class: 'btn', onClick: () => modal.remove(), text: 'Cancel' }),
            el('button', { type: 'submit', class: 'btn primary', text: 'Save changes' })
          )
        )
      )
    );
    document.body.append(modal);
  } catch (err) {
    notify(err.message, true);
  }
}

async function loadSourcesView(container) {
  container.innerHTML = '';
  const toolbar = el('div', { class: 'toolbar' },
    el('input', {
      type: 'text',
      class: 'input-control',
      placeholder: 'Enter content key (e.g. movie:550 or tv:1399)…',
      value: state.sourceKey,
      style: 'flex:1; min-width:240px;',
      onKeydown: e => { if (e.key === 'Enter') { state.sourceKey = e.target.value.trim(); fetchSources(); } }
    }),
    el('button', { class: 'btn primary', onClick: () => fetchSources(), text: 'Load sources' }),
    el('button', { class: 'btn', onClick: () => openAddSourceModal(() => fetchSources()), text: '+ Add source' })
  );

  const tablePanel = el('div', { class: 'table-panel' });
  container.append(toolbar, tablePanel);

  async function fetchSources() {
    if (!state.sourceKey) {
      tablePanel.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted);">Enter a content key above to view and manage its sources.</div>';
      return;
    }
    tablePanel.innerHTML = '<div style="padding:40px; text-align:center;"><span class="spinner"></span></div>';
    try {
      const data = await api(`/sources?key=${encodeURIComponent(state.sourceKey)}`);
      tablePanel.innerHTML = '';
      if (!data.items?.length) {
        tablePanel.innerHTML = '<div style="padding:40px; text-align:center; color:var(--text-muted);">No sources added for this content yet.</div>';
        return;
      }
      const table = el('table', { class: 'data-table' },
        el('thead', {},
          el('tr', {},
            el('th', { text: 'Kind' }),
            el('th', { text: 'Label' }),
            el('th', { text: 'Quality' }),
            el('th', { text: 'URL' }),
            el('th', { text: 'Order' }),
            el('th', { style: 'text-align:right;', text: 'Action' })
          )
        ),
        el('tbody', {},
          data.items.map(s => el('tr', {},
            el('td', {}, el('span', { class: `badge ${s.kind === 'playback' ? 'published' : 'draft'}`, text: s.kind })),
            el('td', { style: 'font-weight:600;', text: s.label || 'Server' }),
            el('td', { text: s.quality || 'Auto' }),
            el('td', { style: 'max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }, el('a', { href: s.url, target: '_blank', style: 'color:var(--blue);', text: s.url })),
            el('td', { text: s.sort_order }),
            el('td', { style: 'text-align:right;' },
              el('button', {
                class: 'btn small danger',
                onClick: async () => {
                  if (confirm('Delete this source link?')) {
                    await api(`/sources/${s.id}`, { method: 'DELETE' });
                    notify('Source deleted');
                    fetchSources();
                  }
                },
                text: 'Delete'
              })
            )
          ))
        )
      );
      tablePanel.append(table);
    } catch (err) {
      tablePanel.innerHTML = `<div class="toast error">${err.message}</div>`;
    }
  }

  fetchSources();
}

function openAddSourceModal(onDone) {
  const modal = el('div', { class: 'modal-layer' },
    el('div', { class: 'modal-window' },
      el('div', { class: 'modal-header' },
        el('h3', { text: 'Add media source' }),
        el('button', { class: 'toast-close', onClick: () => modal.remove() }, icon('close'))
      ),
      el('form', {
        onSubmit: async e => {
          e.preventDefault();
          const body = {
            content_key: e.target.content_key.value.trim(),
            kind: e.target.kind.value,
            label: e.target.label.value.trim(),
            quality: e.target.quality.value.trim(),
            url: e.target.url.value.trim(),
            season_number: Number(e.target.season_number.value || 0),
            episode_number: Number(e.target.episode_number.value || 0)
          };
          try {
            await api('/sources', { method: 'POST', body });
            notify('Source added successfully');
            modal.remove();
            onDone();
          } catch (err) {
            notify(err.message, true);
          }
        }
      },
        el('div', { class: 'form-field' },
          el('label', { text: 'Content Key' }),
          el('input', { type: 'text', name: 'content_key', value: state.sourceKey, required: true, placeholder: 'e.g. movie:550' })
        ),
        el('div', { class: 'form-field' },
          el('label', { text: 'Source type' }),
          el('select', { name: 'kind' },
            el('option', { value: 'playback', text: 'Playback (Watch)' }),
            el('option', { value: 'download', text: 'Download link' })
          )
        ),
        el('div', { class: 'form-field' },
          el('label', { text: 'Server Name / Label' }),
          el('input', { type: 'text', name: 'label', placeholder: 'Vidmoly, Mega, etc.', required: true })
        ),
        el('div', { class: 'form-field' },
          el('label', { text: 'Quality' }),
          el('input', { type: 'text', name: 'quality', placeholder: '1080p, 720p...' })
        ),
        el('div', { class: 'form-field' },
          el('label', { text: 'Source URL' }),
          el('input', { type: 'url', name: 'url', required: true, placeholder: 'https://...' })
        ),
        el('div', { class: 'form-field' },
          el('label', { text: 'Season (TV only, 0 for movies)' }),
          el('input', { type: 'number', name: 'season_number', value: 0, min: 0 })
        ),
        el('div', { class: 'form-field' },
          el('label', { text: 'Episode (TV only, 0 for movies)' }),
          el('input', { type: 'number', name: 'episode_number', value: 0, min: 0 })
        ),
        el('div', { style: 'display:flex; justify-content:flex-end; gap:8px; margin-top:20px;' },
          el('button', { type: 'button', class: 'btn', onClick: () => modal.remove(), text: 'Cancel' }),
          el('button', { type: 'submit', class: 'btn primary', text: 'Add source' })
        )
      )
    )
  );
  document.body.append(modal);
}

async function loadTaxonomyView(container) {
  container.innerHTML = '<div style="padding:40px; text-align:center;"><span class="spinner"></span></div>';
  try {
    const data = await api('/taxonomy');
    container.innerHTML = '';
    const table = el('table', { class: 'data-table' },
      el('thead', {},
        el('tr', {},
          el('th', { text: 'Key' }),
          el('th', { text: 'Label' }),
          el('th', { text: 'Path' }),
          el('th', { text: 'Status' }),
          el('th', { style: 'text-align:right;', text: 'Action' })
        )
      ),
      el('tbody', {},
        (data.items || []).map(t => el('tr', {},
          el('td', { style: 'font-weight:600;', text: t.key }),
          el('td', { text: t.label }),
          el('td', { style: 'color:var(--text-muted);', text: t.path }),
          el('td', {}, el('span', { class: `badge ${t.enabled ? 'published' : 'hidden'}`, text: t.enabled ? 'Enabled' : 'Disabled' })),
          el('td', { style: 'text-align:right;' },
            el('button', {
              class: 'btn small',
              onClick: async () => {
                await api(`/taxonomy/${encodeURIComponent(t.key)}`, {
                  method: 'PATCH',
                  body: { label: t.label, enabled: !t.enabled, sort_order: t.sort_order }
                });
                notify('Category updated');
                loadTaxonomyView(container);
              },
              text: t.enabled ? 'Disable' : 'Enable'
            })
          )
        ))
      )
    );
    container.append(el('div', { class: 'table-panel' }, table));
  } catch (err) {
    container.innerHTML = `<div class="toast error">${err.message}</div>`;
  }
}

async function loadSettingsView(container) {
  container.innerHTML = '<div style="padding:40px; text-align:center;"><span class="spinner"></span></div>';
  try {
    const data = await api('/settings');
    const s = data.settings || {};
    container.innerHTML = '';

    const form = el('form', {
      style: 'max-width:640px; background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:28px;',
      onSubmit: async e => {
        e.preventDefault();
        const body = {
          site_name: form.site_name.value.trim(),
          site_description: form.site_description.value.trim(),
          contact_email: form.contact_email.value.trim(),
          header_notice: form.header_notice.value.trim(),
          sync_interval_hours: Number(form.sync_interval.value || 5),
          sync_enabled: form.sync_enabled.checked,
          maintenance: form.maintenance.checked
        };
        try {
          await api('/settings', { method: 'PUT', body });
          notify('Settings saved successfully');
        } catch (err) {
          notify(err.message, true);
        }
      }
    },
      el('div', { class: 'form-field' },
        el('label', { text: 'Site Name' }),
        el('input', { type: 'text', name: 'site_name', value: s.site_name || 'سيما هَب', required: true })
      ),
      el('div', { class: 'form-field' },
        el('label', { text: 'Site Description (Meta)' }),
        el('textarea', { name: 'site_description', rows: 3, value: s.site_description || '' })
      ),
      el('div', { class: 'form-field' },
        el('label', { text: 'Contact Email' }),
        el('input', { type: 'email', name: 'contact_email', value: s.contact_email || '' })
      ),
      el('div', { class: 'form-field' },
        el('label', { text: 'Header Notice Banner' }),
        el('input', { type: 'text', name: 'header_notice', value: s.header_notice || '' })
      ),
      el('div', { class: 'form-field' },
        el('label', { text: 'Sync Interval (Hours)' }),
        el('input', { type: 'number', name: 'sync_interval', min: 1, max: 72, value: s.sync_interval_hours || 5 })
      ),
      el('div', { class: 'form-field', style: 'display:flex; align-items:center; gap:8px;' },
        el('input', { type: 'checkbox', name: 'sync_enabled', id: 'f_sync', checked: s.sync_enabled !== false }),
        el('label', { for: 'f_sync', style: 'margin:0; cursor:pointer;', text: 'Enable automatic background sync' })
      ),
      el('div', { class: 'form-field', style: 'display:flex; align-items:center; gap:8px;' },
        el('input', { type: 'checkbox', name: 'maintenance', id: 'f_maint', checked: Boolean(s.maintenance) }),
        el('label', { for: 'f_maint', style: 'margin:0; cursor:pointer; color:#ff858d;', text: 'Maintenance Mode (Block public visitors)' })
      ),
      el('button', { type: 'submit', class: 'btn primary', style: 'margin-top:12px;', text: 'Save settings' })
    );

    container.append(form);
  } catch (err) {
    container.innerHTML = `<div class="toast error">${err.message}</div>`;
  }
}

async function loadJobsView(container) {
  container.innerHTML = '<div style="padding:40px; text-align:center;"><span class="spinner"></span></div>';
  try {
    const data = await api('/jobs');
    container.innerHTML = '';

    const triggers = el('div', { class: 'stats-row' },
      el('div', { class: 'stat-box' },
        el('div', { class: 'title', text: 'Movie Sources' }),
        el('div', { style: 'font-weight:600; margin-bottom:12px;', text: 'Update video links' }),
        el('button', {
          class: 'btn primary small',
          onClick: async () => {
            await api('/jobs/sources/run', { method: 'POST' });
            notify('Sources sync triggered');
            loadJobsView(container);
          },
          text: 'Run now'
        })
      ),
      el('div', { class: 'stat-box' },
        el('div', { class: 'title', text: 'Movie Discovery' }),
        el('div', { style: 'font-weight:600; margin-bottom:12px;', text: 'Discover new titles' }),
        el('button', {
          class: 'btn primary small',
          onClick: async () => {
            await api('/jobs/discovery/run', { method: 'POST' });
            notify('Discovery triggered');
            loadJobsView(container);
          },
          text: 'Run now'
        })
      ),
      el('div', { class: 'stat-box' },
        el('div', { class: 'title', text: '18+ Section' }),
        el('div', { style: 'font-weight:600; margin-bottom:12px;', text: 'Refresh adult movies' }),
        el('button', {
          class: 'btn primary small',
          onClick: async () => {
            await api('/jobs/adult/run', { method: 'POST' });
            notify('Adult category sync triggered');
            loadJobsView(container);
          },
          text: 'Run now'
        })
      )
    );

    const runsTable = el('div', { class: 'table-panel', style: 'margin-top:20px;' },
      el('table', { class: 'data-table' },
        el('thead', {},
          el('tr', {},
            el('th', { text: 'Job' }),
            el('th', { text: 'Status' }),
            el('th', { text: 'Executed At' })
          )
        ),
        el('tbody', {},
          (data.runs || []).map(r => el('tr', {},
            el('td', { style: 'font-weight:600;', text: r.job }),
            el('td', {}, el('span', { class: `badge ${r.status === 'success' ? 'published' : r.status === 'running' ? 'draft' : 'hidden'}`, text: r.status })),
            el('td', { style: 'color:var(--text-muted);', text: new Date(r.created_at).toLocaleString() })
          ))
        )
      )
    );

    container.append(triggers, runsTable);
  } catch (err) {
    container.innerHTML = `<div class="toast error">${err.message}</div>`;
  }
}

async function loadUsersView(container) {
  container.innerHTML = '<div style="padding:40px; text-align:center;"><span class="spinner"></span></div>';
  try {
    const data = await api('/users');
    container.innerHTML = '';
    const table = el('table', { class: 'data-table' },
      el('thead', {},
        el('tr', {},
          el('th', { text: 'Email' }),
          el('th', { text: 'Role' }),
          el('th', { text: 'Active' }),
          el('th', { text: 'Created At' })
        )
      ),
      el('tbody', {},
        (data.items || []).map(u => el('tr', {},
          el('td', { style: 'font-weight:600;', text: u.email }),
          el('td', { text: u.role }),
          el('td', {}, el('span', { class: `badge ${u.active ? 'published' : 'hidden'}`, text: u.active ? 'Active' : 'Inactive' })),
          el('td', { style: 'color:var(--text-muted);', text: new Date(u.created_at).toLocaleDateString() })
        ))
      )
    );
    container.append(el('div', { class: 'table-panel' }, table));
  } catch (err) {
    container.innerHTML = `<div class="toast error">${err.message}</div>`;
  }
}

function loadAccountView(container) {
  container.innerHTML = '';
  const form = el('form', {
    style: 'max-width:440px; background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:28px;',
    onSubmit: async e => {
      e.preventDefault();
      const currentPassword = form.current_password.value;
      const newPassword = form.new_password.value;
      const confirmPassword = form.confirm_password.value;
      if (newPassword !== confirmPassword) {
        notify('Passwords do not match', true);
        return;
      }
      try {
        await api('/password', { method: 'POST', body: { currentPassword, newPassword } });
        notify('Password updated. Please sign in again.');
        state.user = null;
        render();
      } catch (err) {
        notify(err.message, true);
      }
    }
  },
    el('h3', { style: 'margin-bottom:16px;', text: 'Change Password' }),
    el('div', { class: 'form-field' },
      el('label', { text: 'Current password' }),
      el('input', { type: 'password', name: 'current_password', required: true })
    ),
    el('div', { class: 'form-field' },
      el('label', { text: 'New password (min 12 characters)' }),
      el('input', { type: 'password', name: 'new_password', required: true, minlength: 12 })
    ),
    el('div', { class: 'form-field' },
      el('label', { text: 'Confirm new password' }),
      el('input', { type: 'password', name: 'confirm_password', required: true, minlength: 12 })
    ),
    el('button', { type: 'submit', class: 'btn primary', style: 'margin-top:12px;', text: 'Update password' })
  );

  container.append(form);
}

// Initial Boot
async function boot() {
  try {
    const res = await api('/session');
    state.user = res.user;
    state.csrf = res.csrf;
  } catch {
    state.user = null;
  }
  render();
}

boot();
