import EventEmitter from 'events'
import intersection from 'lodash.intersection'
import { proxyValue } from 'comlinkjs'
import { status } from '@grpc/grpc-js'
import LndGrpc from 'lnd-grpc'
import { grpcLog } from '@zap/utils/log'
import lightningMethods from './lightning.methods'
import lightningSubscriptions from './lightning.subscriptions'
import { forwardAll, unforwardAll } from './helpers'

const GRPC_WALLET_UNLOCKER_SERVICE_ACTIVE = 'GRPC_WALLET_UNLOCKER_SERVICE_ACTIVE'
const GRPC_LIGHTNING_SERVICE_ACTIVE = 'GRPC_LIGHTNING_SERVICE_ACTIVE'

/**
 * LND gRPC wrapper.
 * @extends EventEmitter
 */
class ZapGrpc extends EventEmitter {
  static INITIAL_STATE = {
    options: {},
    services: {},
    subscriptions: [],
  }

  static SUBSCRIPTIONS = [
    'subscribeInvoices',
    'subscribeChannelGraph',
    'subscribeTransactions',
    'subscribeGetInfo',
  ]

  constructor() {
    super()
    Object.assign(this, ZapGrpc.INITIAL_STATE)
  }

  /**
   * Initiate gRPC connection.
   */
  connect(options) {
    if (this.grpc && this.grpc.state !== 'ready') {
      throw new Error('Can not connect (already connected)')
    }

    this.options = options

    // Create a new grpc instance using settings from init options.
    const grpcOptions = this.getConnectionSettings()
    this.grpc = new LndGrpc(grpcOptions)

    // Set up service accessors.
    this.services = this.grpc.services

    // Inject helper methods.
    Object.assign(this.services.Lightning, lightningMethods)
    Object.assign(this.services.Lightning, lightningSubscriptions)

    // Setup gRPC event handlers.
    this.grpc.on('locked', () => {
      this.emit(GRPC_WALLET_UNLOCKER_SERVICE_ACTIVE)
    })
    this.grpc.on('active', () => {
      this.emit(GRPC_LIGHTNING_SERVICE_ACTIVE)
      this.subscribeAll()
    })
    this.grpc.on('disconnected', () => {
      this.unsubscribe()
    })

    // Setup subscription event forwarders.
    ZapGrpc.SUBSCRIPTIONS.forEach(subscription =>
      forwardAll(this.services.Lightning, subscription, this)
    )

    // Connect the service.
    return this.grpc.connect(options)
  }

  /**
   * Disconnect gRPC service.
   */
  async disconnect(...args) {
    if (this.grpc) {
      if (this.grpc.can('disconnect')) {
        await this.grpc.disconnect(args)
      }
      // Remove gRPC event handlers.
      this.grpc.removeAllListeners('locked')
      this.grpc.removeAllListeners('active')
      this.grpc.removeAllListeners('disconnected')
    }

    // Remove subscription event forwarders.
    ZapGrpc.SUBSCRIPTIONS.forEach(subscription => {
      if (this.services.Lightning) {
        unforwardAll(this.services.Lightning, subscription)
      }
    })

    // Reset the state.
    Object.assign(this, ZapGrpc.INITIAL_STATE)
  }

  /**
   * Wait for grpc service to enter specific sate (proxy method)
   */
  waitForState(...args) {
    return proxyValue(this.grpc.waitForState(args))
  }

  /**
   * Subscribe to all gRPC streams.
   */
  subscribeAll() {
    const { Lightning } = this.services
    this.subscriptions['invoices'] = Lightning.subscribeInvoices()
    this.subscriptions['transactions'] = Lightning.subscribeTransactions()
    this.subscriptions['getinfo'] = Lightning.subscribeGetInfo()
    this.subscribe()

    // subscribe to graph updates only after sync is complete
    // this is needed because LND chanRouter waits for chain sync
    // to complete before accepting subscriptions
    this.on('subscribeGetInfo.data', data => {
      const { synced_to_chain } = data
      if (synced_to_chain && !this.subscriptions['channelGraph']) {
        const { Lightning } = this.services
        this.subscriptions['channelGraph'] = Lightning.subscribeChannelGraph()
        this.subscribe('channelGraph')
      }
    })
  }

  /**
   * @param {...string} services optional list of services to subscribe to. if omitted, uses all services
   * @services must be a subset of `this.subscriptions`
   */
  subscribe(...services) {
    const allSubKeys = Object.keys(this.subscriptions)
    // make sure we are subscribing to known services if a specific list is provided
    const activeSubKeys =
      services && services.length ? intersection(allSubKeys, services) : allSubKeys
    // Close and clear subscriptions when they emit an end event.
    activeSubKeys.forEach(key => {
      const call = this.subscriptions[key]
      if (call) {
        call.on('end', () => {
          grpcLog.info(`gRPC subscription "${key}" ended.`)
          delete this.subscriptions[key]
        })

        call.on('status', callStatus => {
          if (callStatus.code === status.CANCELLED) {
            delete this.subscriptions[key]
            grpcLog.info(`gRPC subscription "${key}" ended.`)
          }
        })
      }
    })
  }

  /**
   * Unsubscribe from all streams.
   * @param {...string} services optional list of services to unsubscribe from. if omitted, uses all services
   * @services must be a subset of `this.subscriptions`
   */
  async unsubscribe(...services) {
    const allSubKeys = Object.keys(this.subscriptions)
    // make sure we are unsubscribing from known services if a specific list is provided
    const activeSubKeys =
      services && services.length ? intersection(allSubKeys, services) : allSubKeys
    grpcLog.info(`Unsubscribing from all gRPC streams: %o`, activeSubKeys)
    const cancellations = activeSubKeys.map(key => this.cancelSubscription(key))
    await Promise.all(cancellations)
  }

  /**
   * Unsubscribe from a single stream.
   */
  async cancelSubscription(key) {
    grpcLog.info(`Unsubscribing from ${key} gRPC stream`)
    const call = this.subscriptions[key]

    // Cancellation status callback handler.
    const result = new Promise(resolve => {
      call.on('status', callStatus => {
        if (callStatus.code === status.CANCELLED) {
          delete this.subscriptions[key]
          grpcLog.info(`Unsubscribed from ${key} gRPC stream`)
          resolve()
        }
      })

      call.on('end', () => {
        delete this.subscriptions[key]
        grpcLog.info(`Unsubscribed from ${key} gRPC stream`)
        resolve()
      })
    })

    // Initiate cancellation request.
    call.cancel()
    // Resolve once we receive confirmation of the call's cancellation.
    return result
  }

  /**
   * Get connection details based on wallet config.
   */
  getConnectionSettings() {
    const { id, type, host, cert, macaroon, protoDir } = this.options
    // Don't use macaroons when connecting to the local tmp instance.
    const useMacaroon = this.useMacaroon && id !== 'tmp'
    // If connecting to a local instance, wait for the macaroon file to exist.
    const waitForMacaroon = type === 'local'
    const waitForCert = type === 'local'

    return { host, cert, macaroon, waitForMacaroon, waitForCert, useMacaroon, protoDir }
  }
}

export default ZapGrpc