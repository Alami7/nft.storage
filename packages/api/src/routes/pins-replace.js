import mergeOptions from 'merge-options'
import { CID } from 'multiformats'
import * as PinataPSA from '../pinata-psa.js'
import { JSONResponse } from '../utils/json-response.js'
import * as nfts from '../models/nfts.js'
import * as pinataQueue from '../models/pinata-queue.js'
import * as cluster from '../cluster.js'
import { validate } from '../utils/auth.js'
import { obtainNft, obtainPin } from './pins-add.js'
import { debug } from '../utils/debug.js'

const merge = mergeOptions.bind({ ignoreUndefined: true })
const log = debug('pin-replace')

/** @type {import('../utils/router.js').Handler} */
export async function pinsReplace(event, ctx) {
  const { params } = ctx
  const { user, tokenName } = await validate(event, ctx)
  let existingCID = params.requestid
  let found = await nfts.get({ user, cid: existingCID })

  if (!found) {
    // maybe this is an old Pinata pin?
    const res = await PinataPSA.pinsGet(params.requestid)
    if (res.ok) {
      existingCID = res.value.pin.cid
      found = await nfts.get({ user, cid: existingCID })
    }
  }

  if (!found) {
    return new JSONResponse(
      { error: { reason: 'NOT_FOUND', details: 'pin not found' } },
      { status: 404 }
    )
  }

  const pinData = await event.request.json()
  try {
    CID.parse(pinData.cid)
  } catch {
    return new JSONResponse(
      { error: { reason: 'INVALID_PIN_DATA', details: 'invalid CID' } },
      { status: 400 }
    )
  }
  if (pinData.cid === existingCID) {
    return new JSONResponse(
      {
        error: {
          reason: 'INVALID_PIN_DATA',
          details: 'exiting and replacement CID are the same',
        },
      },
      { status: 400 }
    )
  }
  if (pinData.name && typeof pinData.name !== 'string') {
    return new JSONResponse(
      { error: { reason: 'INVALID_PIN_DATA', details: 'invalid name' } },
      { status: 400 }
    )
  }

  const name = pinData.name

  let meta
  if (pinData.meta) {
    if (typeof pinData.meta !== 'object' || Array.isArray(pinData.meta)) {
      return new JSONResponse(
        { error: { reason: 'INVALID_PIN_DATA', details: 'invalid metadata' } },
        { status: 400 }
      )
    }
    meta = Object.fromEntries(
      Object.entries(pinData.meta).filter(([, v]) => typeof v === 'string')
    )
  }

  const pin = await obtainPin(pinData.cid)

  const origins = [...(pinData.origins || []), ...cluster.delegates()]
  event.waitUntil(pinataQueue.add(pinData.cid, { origins }))

  const nft = await obtainNft(user, tokenName, pin, { name, meta })
  await nfts.remove({ user, cid: existingCID })

  /** @type import('../pinata-psa').PinStatus */
  const pinStatus = {
    requestid: pin.cid,
    status: pin.status,
    created: pin.created,
    pin: { cid: pin.cid, ...(nft.pin || {}) },
    delegates: cluster.delegates(),
  }
  return new JSONResponse(pinStatus)
}
