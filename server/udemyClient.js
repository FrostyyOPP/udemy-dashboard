// Thin wrapper around the Udemy Instructor API.
// Docs: https://www.udemy.com/developers/instructor/
// Auth: a single API key sent as a Bearer token (confirmed against the live API).

import 'dotenv/config';

const BASE_URL = 'https://www.udemy.com/instructor-api/v1';

const { UDEMY_API_KEY } = process.env;

function authHeader() {
  if (!UDEMY_API_KEY) {
    throw new Error('Missing UDEMY_API_KEY in server/.env');
  }
  return `Bearer ${UDEMY_API_KEY}`;
}

/**
 * Call any Udemy instructor endpoint.
 * @param {string} path  e.g. "/taught-courses/courses/" (leading slash optional)
 * @param {object} query optional query params, e.g. { page: 1, page_size: 20 }
 */
export async function udemyGet(path, query = {}) {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(BASE_URL + clean);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json, text/plain, */*',
    },
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text; // surface HTML/error pages as-is for debugging
  }

  if (!res.ok) {
    const err = new Error(`Udemy API ${res.status} on ${clean}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

export { BASE_URL };
