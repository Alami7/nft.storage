import { getMagic } from './magic'
import constants from './constants'

export const API = constants.API

const LIFESPAN = 900
/** @type {string | undefined} */
let token
let created = Date.now() / 1000

export async function getToken() {
  const magic = getMagic()
  const now = Date.now() / 1000
  if (token === undefined || now - created > LIFESPAN - 10) {
    token = await magic.user.getIdToken({ lifespan: LIFESPAN })
    created = Date.now() / 1000
  }
  return token
}

/**
 * @param {string} version
 */
export async function getTokens(version) {
  const route = version === '1' ? '/v1/internal/tokens' : '/internal/tokens'
  const res = await fetch(API + route, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (await getToken()),
    },
  })

  const body = await res.json()

  if (body.ok) {
    return body.value
  } else {
    throw new Error(body.error.message)
  }
}

/**
 * Delete Token
 *
 * @param {string} name
 * @param {string | undefined} [version]
 */
export async function deleteToken(name, version) {
  const route = version === '1' ? '/v1/internal/tokens' : '/internal/tokens'
  const data = version === '1' ? { id: name } : { name }
  const res = await fetch(API + route, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (await getToken()),
    },
    body: JSON.stringify(data),
  })

  const body = await res.json()

  if (body.ok) {
    return body
  } else {
    throw new Error(body.error.message)
  }
}

/**
 * Create Token
 *
 * @param {string} name
 * @param {string | undefined} [version]
 */
export async function createToken(name, version) {
  const route = version === '1' ? '/v1/internal/tokens' : '/internal/tokens'
  const res = await fetch(API + route, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (await getToken()),
    },
    body: JSON.stringify({ name }),
  })

  const body = await res.json()

  if (body.ok) {
    return body
  } else {
    throw new Error(body.error.message)
  }
}

/**
 * Get NFTs
 *
 * @param {{limit: number, before: string }} query
 * @param {string} version
 * @returns
 */
export async function getNfts({ limit, before }, version = '') {
  const route = version === '1' ? '/v1' : '/'
  const params = new URLSearchParams({ before, limit: String(limit) })
  const res = await fetch(`${API}${route}?${params}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + (await getToken()),
    },
  })

  const body = await res.json()

  if (body.ok) {
    return body.value.filter(Boolean)
  } else {
    throw new Error(body.error.message)
  }
}
