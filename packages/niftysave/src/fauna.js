import * as Service from './service.js'
import fauna from 'faunadb'

const {
  Client,
  Ref,
  Select,
  Expr,
  Create,
  Collection,
  Get,
  Var,
  Documents,
  Lambda,
  Paginate,
  Call,
  Update,
  Now,
  Map,
  Do,
  Let,
  If,
  IsNull,
} = fauna

export {
  Create,
  Expr,
  Collection,
  Get,
  If,
  IsNull,
  Var,
  Select,
  Documents,
  Lambda,
  Paginate,
  Call,
  Update,
  Now,
  Map,
  Do,
  Let,
  Ref,
}

/**
 * @typedef {import('faunadb').ClientConfig} Config
 * @param {Config} config
 * @returns {import('faunadb').Client}
 */

const connect = (config) => new Client({ secret: config.secret })
const service = Service.create(connect)

/**
 *
 * @param {Config} config
 * @param {import('faunadb').Expr} expr
 * @param {import('faunadb').QueryOptions} [options]
 */
export const query = (config, expr, options) =>
  service(config).query(expr, options)
