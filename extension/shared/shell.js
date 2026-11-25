const sidebar = document.querySelector('.sidebar');
if (sidebar) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'nav-toggle';
  toggle.textContent = '菜单';
  toggle.setAttribute('aria-expanded', 'false');
  const links = document.createElement('nav');
  links.id = 'page-navigation';
  links.className = 'page-navigation';
  links.setAttribute('aria-label', '主导航');
  sidebar.querySelectorAll('a.nav').forEach(link => links.appendChild(link));
  toggle.setAttribute('aria-controls', links.id);
  sidebar.querySelector('.brand').after(toggle, links);
  function close() {
    sidebar.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');
  }
  toggle.addEventListener('click', () => {
    const open = sidebar.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  sidebar.addEventListener('keydown', event => {
    if (event.key === 'Escape' && sidebar.classList.contains('nav-open')) { close(); toggle.focus(); }
  });
}
