// Scroll reveal
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
);

document.querySelectorAll('.scroll-reveal').forEach((el) => observer.observe(el));

// Counter slot animation
(function counterTick() {
  const reel = document.querySelector('.counter-reel');
  if (!reel) return;

  const seen = sessionStorage.getItem('counter_done');
  if (seen) {
    reel.style.transform = 'translateY(-2em)';
    reel.style.transition = 'none';
    return;
  }

  setTimeout(() => {
    reel.style.transform = 'translateY(-1em)';
  }, 3000);

  setTimeout(() => {
    reel.style.transform = 'translateY(-2em)';
    sessionStorage.setItem('counter_done', '1');
  }, 53000);
})();

// Subscribe forms
document.querySelectorAll('[data-subscribe]').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const input = form.querySelector('input[type="email"]');
    const wrapper = form.closest('.subscribe-wrapper');
    const message = wrapper.querySelector('.form-message');
    const email = input.value.trim();

    if (!email) return;

    form.classList.remove('success');
    form.classList.add('loading');
    message.className = 'form-message';

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (res.ok) {
        form.classList.add('success');
        input.value = '';
        message.textContent = "You're in! Check your inbox :)";
        message.className = 'form-message success';
      } else {
        message.textContent = data.error || 'Something went wrong. Try again.';
        message.className = 'form-message error';
      }
    } catch {
      message.textContent = 'Something went wrong. Try again.';
      message.className = 'form-message error';
    } finally {
      form.classList.remove('loading');
    }
  });
});

// Archive
(async function loadArchive() {
  const list = document.getElementById('archive-list');
  const searchInput = document.getElementById('archive-search');
  let posts = [];

  try {
    const res = await fetch('/api/posts');
    if (!res.ok) throw new Error();
    posts = await res.json();
  } catch {
    list.innerHTML = '<p class="archive-empty">Could not load archive.</p>';
    return;
  }

  if (!posts.length) {
    list.innerHTML = '<p class="archive-empty">No posts yet. Stay tuned.</p>';
    return;
  }

  function formatDate(unix) {
    return new Date(unix * 1000).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function render(filtered) {
    if (!filtered.length) {
      list.innerHTML = '<p class="archive-empty">No matching posts.</p>';
      return;
    }

    list.innerHTML = filtered
      .map(
        (post) => `
        <a href="${post.url}" target="_blank" rel="noopener noreferrer" class="archive-item">
          <div class="archive-item-date">${formatDate(post.date)}</div>
          <div class="archive-item-title">${post.title}</div>
          ${post.preview ? `<div class="archive-item-preview">${post.preview}</div>` : ''}
        </a>`
      )
      .join('');
  }

  render(posts);

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    if (!q) return render(posts);

    const filtered = posts.filter(
      (p) =>
        p.title?.toLowerCase().includes(q) ||
        p.preview?.toLowerCase().includes(q) ||
        p.subtitle?.toLowerCase().includes(q) ||
        p.tags?.some((t) => t.toLowerCase().includes(q))
    );
    render(filtered);
  });
})();
