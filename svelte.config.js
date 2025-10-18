import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter(),
    serviceWorker: {
      register: false
    }
  },
  onwarn: (warning, handler) => {
    if (warning.code === 'a11y-media-has-caption') return;
    handler(warning);
  }
};

export default config;