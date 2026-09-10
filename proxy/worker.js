/* A second road to the same server.
 *
 * ACT Fibernet answers every name under supabase.co with one of its own
 * addresses, and does it by intercepting plain DNS on the wire — so nothing
 * done to the router's DNS settings helps, and the app cannot choose how a
 * phone resolves names. What it can do is know a second name for the same
 * server. This Worker IS that second name: it forwards every request it
 * receives — REST, auth, storage, and the Realtime websocket — to the project
 * unchanged, and hands the answer back. It lives on a free *.workers.dev
 * subdomain, which ACT resolves correctly, so no domain has to be bought.
 *
 * Nothing is stored, logged or inspected here. The only thing this code
 * touches is the Host header, because the upstream routes by it.
 *
 * TO DEPLOY (five minutes, once):
 *   1. https://dash.cloudflare.com → sign up or in (free) → Workers & Pages
 *      → Create → "Start with Hello World" → name it, e.g. crescent-api.
 *   2. Edit code → replace everything with this file → Deploy.
 *   3. Copy the address it gives you: https://crescent-api.<account>.workers.dev
 *   4. Put that address into API_HOSTS in index.html (the commented slot).
 *   5. Check: open https://crescent-api.<account>.workers.dev/rest/v1/ in a
 *      browser — a JSON error mentioning an API key means it is forwarding.
 */
const UPSTREAM = "https://hwbquljbvanlgggemchg.supabase.co";
const UPSTREAM_HOST = new URL(UPSTREAM).host;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = UPSTREAM + url.pathname + url.search;
    const headers = new Headers(request.headers);
    headers.set("Host", UPSTREAM_HOST);
    /* A websocket upgrade (the live editing signal) is a fetch like any other
       here: the runtime returns the 101 with the socket attached, and
       returning that response hands the socket through to the client. */
    return fetch(target, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });
  },
};
