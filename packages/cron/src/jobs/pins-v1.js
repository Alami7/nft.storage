import debug from 'debug'

const log = debug('pins:updatePinStatuses')

/**
 * @typedef {import('../../../api/src/utils/db-types').definitions} definitions
 * @typedef {Pick<definitions['pin'], 'id'|'status'|'content_cid'|'service'|'updated_at'>} Pin
 * @typedef {Pick<definitions['pin'], 'id'|'status'|'updated_at'>} PinUpdate
 * @typedef {import('@supabase/postgrest-js').PostgrestQueryBuilder<Pin>} PinQuery
 */

/**
 * Updates pin status and size by retrieving updated status from cluster.
 *
 * @param {{
 *   db: import('../../../api/src/utils/db-client').DBClient
 *   cluster: import('@nftstorage/ipfs-cluster').Cluster
 * }} config
 */
export async function updatePinStatuses({ db, cluster }) {
  if (!log.enabled) {
    console.log('ℹ️ Enable logging by setting DEBUG=pins:updatePinStatuses')
  }

  const { count, error: countError } = await db.client
    .from('pin')
    .select('*', { count: 'exact', head: true })
    .eq('service', 'IpfsCluster')
    .neq('status', 'Pinned')
    .neq('status', 'PinError')

  if (countError) {
    throw countError
  }

  log(`🎯 Updating pin ${count} statuses`)

  let from = 0
  const pageSize = 1000
  while (true) {
    /** @type {PinQuery} */
    const query = db.client.from('pin')
    const { data: pins, error } = await query
      .select('id,status,content_cid,service')
      .eq('service', 'IpfsCluster')
      .neq('status', 'Pinned')
      .neq('status', 'PinError')
      .range(from, from + pageSize - 1)

    if (error) {
      throw error
    }

    if (!pins) {
      throw new Error('no pins found')
    }

    if (!pins.length) {
      break
    }

    /** @type {PinUpdate[]} */
    const updatedPins = []
    for (const pin of pins) {
      const statusRes = await cluster.status(pin.content_cid)
      const pinInfos = Object.values(statusRes.peerMap)

      /** @type {Pin['status']} */
      let status = 'PinError'
      if (pinInfos.some((i) => i.status === 'pinned')) {
        status = 'Pinned'
      } else if (pinInfos.some((i) => i.status === 'pinning')) {
        status = 'Pinning'
      } else if (pinInfos.some((i) => i.status === 'pin_queued')) {
        status = 'PinQueued'
      }

      if (status !== pin.status) {
        log(`📌 ${pin.content_cid} ${pin.status} => ${status}`)
        updatedPins.push({
          id: pin.id,
          status,
          updated_at: new Date().toISOString(),
        })
      }
    }

    if (updatedPins.length) {
      // bulk upsert
      const { error: updateError } = await db.client
        .from('pin')
        .upsert(updatedPins, { count: 'exact', returning: 'minimal' })

      if (updateError) {
        throw updateError
      }
    }

    log(`ℹ️ ${count} pins to process.`)
    log(`🗂 ${pins.length} processed, ${updatedPins.length} updated.`)

    from += pageSize
  }

  log('✅ Done')
}
