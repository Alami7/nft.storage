import * as Result from './result.js'
import * as Schema from '../gen/db/schema.js'
import * as IPFSURL from './ipfs-url.js'
import * as Cluster from './cluster.js'
import * as DB from '../gen/db/index.js'
import { fetchResource, timeout } from './net.js'
import { configure } from './config.js'
import { printURL } from './util.js'
import { script } from 'subprogram'

const { TokenAssetStatus } = Schema

export const main = async () => await spawn(await configure())

/**
 * @typedef {Object} Config
 * @property {DB.Config} fauna
 * @property {import('./ipfs').Config} ipfs
 * @property {Cluster.Config} cluster
 * @property {number} budget
 * @property {number} batchSize
 * @property {number} fetchTimeout
 */

/**
 * @param {Config} config
 */
export const spawn = async config => {
  const deadline = Date.now() + config.budget
  while (deadline - Date.now() > 0) {
    console.log('🔍 Fetching queued token asset analyses')
    const analyses = await fetchScheduledAnalyses(config)
    if (analyses.length === 0) {
      return console.log('🏁 Finish, no more queued task were found')
    } else {
      console.log(`🤹 Spawn ${analyses.length} tasks to process assets`)
      const updates = await Promise.all(analyses.map($ => analyze(config, $)))

      console.log('💾 Update token assets')
      await updateTokenAssets(config, updates)
      console.log(`✨ Processed batch of ${analyses.length} assets`)
    }
  }
  console.log('⌛️ Finish, time is up')
}

/**
 * @typedef {{ tokenURI:string, _id:string }} TokenAsset
 *
 * Returns batch of queued tokens.
 *
 * @param {{batchSize: number, fauna: DB.Config}} options
 * @returns {Promise<Schema.ScheduledAnalyze[]>}
 */

const fetchScheduledAnalyses = async ({ batchSize, fauna }) => {
  const result = await DB.query(fauna, {
    scheduledAnalyses: [
      {
        _size: batchSize,
      },
      {
        data: {
          attempt: 1,
          tokenAsset: {
            _id: 1,
            tokenURI: 1,
          },
        },
      },
    ],
  })

  const tasks =
    /** @type {Schema.ScheduledAnalyze[]} */
    (Result.value(result).scheduledAnalyses.data.filter(Boolean))

  return tasks
}

/**
 * @param {Config} config
 * @param {Schema.ScheduledAnalyze} scheduledAnalyze
 * @returns {Promise<Schema.TokenAssetUpdate>}
 */
const analyze = async (config, { tokenAsset: { tokenURI, _id: id } }) => {
  console.log(`🔬 (${id}) Parsing tokenURI`)
  const urlResult = Result.fromTry(() => new URL(tokenURI))
  if (!urlResult.ok) {
    console.error(
      `🚨 (${id}) Parsing URL failed ${urlResult.error}, report problem`
    )

    return {
      id,
      status: TokenAssetStatus.URIParseFailed,
      statusText: `${urlResult.error}`,
    }
  }
  const url = urlResult.value
  console.log(`🧬 (${id}) Parsed URL ${printURL(url)}`)
  const ipfsURL = IPFSURL.asIPFSURL(url)
  const asset = ipfsURL ? { id, ipfsURL: ipfsURL.href } : { id }
  ipfsURL && console.log(`🚀 (${id}) Derived IPFS URL ${ipfsURL}`)

  console.log(
    `🌐 (${id}) Fetching token metadata from ${printURL(ipfsURL || url)}`
  )

  const blob = await Result.fromPromise(
    fetchResource(
      config,
      { url, ipfsURL },
      { signal: timeout(config.fetchTimeout) }
    )
  )
  const content = blob.ok ? await Result.fromPromise(blob.value.text()) : blob

  if (!content.ok) {
    console.error(`🚨 (${id}) Fetch failed ${content.error}`)

    return {
      ...asset,
      status: TokenAssetStatus.ContentFetchFailed,
      statusText: `${content.error}`,
    }
  }

  console.log(`🔬 (${id}) Parsing token metadata`)

  const metadata = await Result.fromPromise(parseERC721Metadata(content.value))
  if (!metadata.ok) {
    console.error(`🚨 (${id}) Parse failed ${metadata.error}`)

    return {
      ...asset,
      status: TokenAssetStatus.ContentParseFailed,
      statusText: `${metadata.error}`,
    }
  }

  console.log(`📌 (${id}) Pinning token metadata ${ipfsURL || 'by uploading'}`)

  const pin = ipfsURL
    ? await Result.fromPromise(
        Cluster.pin(config.cluster, ipfsURL, {
          signal: timeout(config.fetchTimeout),
          metadata: {
            assetID: id,
            sourceURL: tokenURI,
          },
        })
      )
    : await Result.fromPromise(
        Cluster.add(config.cluster, new Blob([content.value]), {
          signal: timeout(config.fetchTimeout),
          metadata: {
            assetID: id,
            // if it is a data uri just omit it.
            ...(url.protocol !== 'data:' && { sourceURL: url.href }),
          },
        })
      )

  if (!pin.ok) {
    console.error(`🚨 (${id}) Failed to pin ${pin.error}`)
    return {
      ...asset,
      status: TokenAssetStatus.PinRequestFailed,
      statusText: `${pin.error}`,
    }
  }
  const { cid } = pin.value

  console.log(`📝 (${id}) Link token to metadata ${cid}`)
  return {
    ...asset,
    status: TokenAssetStatus.Linked,
    statusText: 'Linked',
    metadata: { ...metadata.value, cid },
  }
}

/**
 * @param {string} content
 */
const parseERC721Metadata = async content => {
  const json = JSON.parse(content)
  const { name, description, image } = json
  if (typeof name !== 'string') {
    throw new Error('name field is missing')
  }
  if (typeof description !== 'string') {
    throw new Error('description field is missing')
  }
  if (typeof image !== 'string') {
    throw new Error('image field is missing')
  }

  const imageResource = parseResource(image)

  /** @type {Schema.ResourceInput[]} */
  const assets = []

  /** @type {Schema.MetadataInput} */
  const metadata = { cid: '', name, description, image: imageResource, assets }
  for (const [value] of iterate({ ...metadata, image: null })) {
    const asset = typeof value === 'string' ? tryParseResource(value) : null
    if (asset) {
      assets.push(asset)
    }
  }

  return metadata
}

/**
 * @param {string} input
 * @returns {Schema.ResourceInput}
 */
const parseResource = input => {
  const url = new URL(input)
  const ipfsURL = IPFSURL.asIPFSURL(url)
  if (ipfsURL) {
    return {
      uri: input,
      ipfsURL: ipfsURL.href,
    }
  } else {
    return {
      uri: input,
    }
  }
}

/**
 *
 * @param {string} input
 */
const tryParseResource = input => {
  try {
    return parseResource(input)
  } catch (error) {
    return null
  }
}

/**
 * @param {Object} data
 * @param {PropertyKey[]} [path]
 * @returns {Iterable<[string|number|boolean|null, PropertyKey[]]>}
 */
const iterate = function*(data, path = []) {
  if (Array.isArray(data)) {
    for (const [index, element] of data) {
      yield* iterate(element, [...path, index])
    }
  } else if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      yield* iterate(value, [...path, key])
    }
  } else {
    yield [data, path]
  }
}

/**
 * @param {{ fauna: DB.Config }} config
 * @param {Schema.TokenAssetUpdate[]} updates
 * @returns {Promise<string[]>}
 */
const updateTokenAssets = async ({ fauna }, updates) => {
  const result = await DB.mutation(fauna, {
    updateTokenAssets: [
      {
        input: { updates },
      },
      {
        _id: 1,
      },
    ],
  })

  return Result.value(result).updateTokenAssets?.map(token => token._id) || []
}

script({ ...import.meta, main })
