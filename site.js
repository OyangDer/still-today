// The newest release's installer, so every download button is one click; the links fall back to the
// Releases page as written. "latest" never returns drafts or pre-releases.
fetch('https://api.github.com/repos/OyangDer/still-today/releases/latest')
  .then((r) => r.json())
  .then((release) => {
    const exe = release.assets.find((a) => a.name.endsWith('-setup.exe'));
    document.querySelectorAll('[data-download]').forEach((a) => (a.href = exe.browser_download_url));
    const meta = `${release.tag_name} · ${(exe.size / 1048576).toFixed(1)} MB · Windows 10 / 11`;
    document.querySelectorAll('[data-meta]').forEach((m) => (m.textContent = meta));
  });

document.querySelectorAll('[data-copy]').forEach((b) =>
  b.addEventListener('click', async () => {
    await navigator.clipboard.writeText(location.origin + location.pathname);
    b.textContent = b.dataset.copied;
  }),
);

const header = document.querySelector('header');
addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 8), { passive: true });

const seen = new IntersectionObserver(
  (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), seen.unobserve(e.target))),
  { rootMargin: '0px 0px -8% 0px' },
);
document.querySelectorAll('.reveal').forEach((el) => seen.observe(el));
