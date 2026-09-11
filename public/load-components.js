async function loadPanel() {
  const mountPoint = document.getElementById('panel-container');
  if (!mountPoint) return;

  try {
    const response = await fetch('panel.html');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const html = await response.text();
    mountPoint.innerHTML = html;

    let currentPath = window.location.pathname.split('/').pop();
    if (!currentPath || currentPath === '') currentPath = 'index.html';

    const navLinks = mountPoint.querySelectorAll('.nav-links a');
    navLinks.forEach(link => {
      if (link.getAttribute('data-page') === currentPath) link.classList.add('active');
      else link.classList.remove('active');
    });

    if (typeof setLanguage === 'function') setLanguage(localStorage.getItem('aurora_lang') || 'en');
  } catch (err) {
    console.error('Error loading component panel:', err);
  } finally {
    // Tell the main page it is safe to remove the preloader and play the video
    window.dispatchEvent(new Event('componentsLoaded'));
  }
}

document.addEventListener('DOMContentLoaded', loadPanel);