/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  ethers,
  Contract,
  Overrides,
  Signer,
  BigNumber,
  CallOverrides,
} from 'ethers'
import {
  TransactionRequest,
  TransactionResponse,
  BlockTag,
} from '@ethersproject/abstract-provider'
import { predeploys, getContractInterface } from '@mantleio/contracts'
import { hexStringEquals } from '@mantleio/core-utils'

import {
  IBridgeAdapter,
  ICrossChainMessenger,
  NumberLike,
  AddressLike,
  TokenBridgeMessage,
  MessageDirection,
} from '../interfaces'
import { toAddress, L1_MNT_ADDRESS } from '../utils'

/**
 * Bridge adapter for any token bridge that uses the standard token bridge interface.
 */
export class StandardBridgeAdapter implements IBridgeAdapter {
  public messenger: ICrossChainMessenger
  public l1Bridge: Contract
  public l2Bridge: Contract

  /**
   * Creates a StandardBridgeAdapter instance.
   *
   * @param opts Options for the adapter.
   * @param opts.messenger Provider used to make queries related to cross-chain interactions.
   * @param opts.l1Bridge L1 bridge contract.
   * @param opts.l2Bridge L2 bridge contract.
   */
  constructor(opts: {
    messenger: ICrossChainMessenger
    l1Bridge: AddressLike
    l2Bridge: AddressLike
  }) {
    this.messenger = opts.messenger
    this.l1Bridge = new Contract(
      toAddress(opts.l1Bridge),
      getContractInterface('L1StandardBridge'),
      this.messenger.l1Provider
    )
    this.l2Bridge = new Contract(
      toAddress(opts.l2Bridge),
      getContractInterface('L2StandardBridge'),
      this.messenger.l2Provider
    )
  }


  public async getDepositsByAddress(
    address: AddressLike,
    opts?: {
      fromBlock?: BlockTag
      toBlock?: BlockTag
    }
  ): Promise<TokenBridgeMessage[]> {
    const events = await this.l1Bridge.queryFilter(
      this.l1Bridge.filters.ERC20DepositInitiated(
        undefined,
        undefined,
        address
      ),
      opts?.fromBlock,
      opts?.toBlock
    )

    return events
      .filter((event) => {
        // Specifically filter out ETH. ETH deposits and withdrawals are handled by the ETH bridge
        // adapter. Bridges that are not the ETH bridge should not be able to handle or even
        // present ETH deposits or withdrawals.
        return (
          !hexStringEquals(event.args._l1Token, ethers.constants.AddressZero) &&
          !hexStringEquals(event.args._l2Token, predeploys.BVM_ETH)
        )
      })
      .map((event) => {
        return {
          direction: MessageDirection.L1_TO_L2,
          from: event.args._from,
          to: event.args._to,
          l1Token: event.args._l1Token,
          l2Token: event.args._l2Token,
          amount: event.args._amount,
          data: event.args._data,
          logIndex: event.logIndex,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
        }
      })
      .sort((a, b) => {
        // Sort descending by block number
        return b.blockNumber - a.blockNumber
      })
  }


  //****/ sos-wallet implementation to share the L1 state root to L2 /*****/
  //****/ This root will be passed along with the event for "Deposit Bridge Message /****/
  //*****/ It will support direct l1 state reading from l2 /****/

  public async getDepositsByAddress(
    address: AddressLike,
    opts?: {
      fromBlock?: BlockTag
      toBlock?: BlockTag
    }
  ): Promise<TokenBridgeMessage[]> {
    const events = await this.l1Bridge.queryFilter(
      this.l1Bridge.filters.ERC20DepositInitiated(
        undefined,
        undefined,
        address
      ),
      opts?.fromBlock,
      opts?.toBlock
    )
    const stateRootOfL1ForSosWallet = this.messenger.getMessageStateRootForSosWallet();

    return events
      .filter((event) => {
        // Specifically filter out ETH. ETH deposits and withdrawals are handled by the ETH bridge
        // adapter. Bridges that are not the ETH bridge should not be able to handle or even
        // present ETH deposits or withdrawals.
        return (
          !hexStringEquals(event.args._l1Token, ethers.constants.AddressZero) &&
          !hexStringEquals(event.args._l2Token, predeploys.BVM_ETH)
        )
      })
      .map((event) => {
        return {
          direction: MessageDirection.L1_TO_L2,
          from: event.args._from,
          to: event.args._to,
          l1Token: event.args._l1Token,
          l2Token: event.args._l2Token,
          amount: event.args._amount,
          data: event.args._data,
          logIndex: event.logIndex,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          stateRootOfL1: stateRootOfL1ForSosWallet
        }
      })
      .sort((a, b) => {
        // Sort descending by block number
        return b.blockNumber - a.blockNumber
      })
  }
    ///*****/ Implementation ends here for sos-wallet"*****/


  public async getWithdrawalsByAddress(
    address: AddressLike,
    opts?: {
      fromBlock?: BlockTag
      toBlock?: BlockTag
    }
  ): Promise<TokenBridgeMessage[]> {
    const events = await this.l2Bridge.queryFilter(
      this.l2Bridge.filters.WithdrawalInitiated(undefined, undefined, address),
      opts?.fromBlock,
      opts?.toBlock
    )

    return events
      .filter((event) => {
        // Specifically filter out ETH. ETH deposits and withdrawals are handled by the ETH bridge
        // adapter. Bridges that are not the ETH bridge should not be able to handle or even
        // present ETH deposits or withdrawals.
        return (
          !hexStringEquals(event.args._l1Token, ethers.constants.AddressZero) &&
          !hexStringEquals(event.args._l2Token, predeploys.BVM_ETH)
        )
      })
      .map((event) => {
        return {
          direction: MessageDirection.L2_TO_L1,
          from: event.args._from,
          to: event.args._to,
          l1Token: event.args._l1Token,
          l2Token: event.args._l2Token,
          amount: event.args._amount,
          data: event.args._data,
          logIndex: event.logIndex,
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
        }
      })
      .sort((a, b) => {
        // Sort descending by block number
        return b.blockNumber - a.blockNumber
      })
  }

  public async supportsTokenPair(
    l1Token: AddressLike,
    l2Token: AddressLike
  ): Promise<boolean> {
    try {
      const contract = new Contract(
        toAddress(l2Token),
        getContractInterface('L2StandardERC20'),
        this.messenger.l2Provider
      )
      // Don't support ETH deposits or withdrawals via this bridge.
      if (
        hexStringEquals(toAddress(l1Token), ethers.constants.AddressZero) ||
        hexStringEquals(toAddress(l2Token), predeploys.BVM_ETH)
      ) {
        return false
      }

      // Make sure the L2 bridge matches.
      const remoteL2Bridge = await contract.l2Bridge()
      if (!hexStringEquals(remoteL2Bridge, this.l2Bridge.address)) {
        return false
      }

      // Make sure the L1 token matches the L1_MNT_ADDRESS associated with this l2ChainId
      const remoteL1Token = await contract.l1Token()
      if (hexStringEquals(remoteL1Token, toAddress(L1_MNT_ADDRESS[this.messenger.l2ChainId]))){
        return true
      }
      if (hexStringEquals(remoteL1Token, toAddress('0x1a4b46696b2bb4794eb3d4c26f1c55f9170fa4c5'))){
        return true
      }

      if (!hexStringEquals(remoteL1Token, toAddress(l1Token))) {
        return false
      }


      return true
    } catch (err) {
      // If the L2 token is not an L2StandardERC20, it may throw an error. If there's a call
      // exception then we assume that the token is not supported. Other errors are thrown.
      if (err.message.toString().includes('CALL_EXCEPTION')) {
        return false
      } else {
        throw err
      }
    }
  }

  public async approval(
    l1Token: AddressLike,
    l2Token: AddressLike,
    signer: ethers.Signer
  ): Promise<BigNumber> {
    if (!(await this.supportsTokenPair(l1Token, l2Token))) {
      throw new Error(`token pair not supported by bridge`)
    }

    const token = new Contract(
      toAddress(l1Token),
      getContractInterface('L2StandardERC20'), // Any ERC20 will do
      this.messenger.l1Provider
    )

    return token.allowance(await signer.getAddress(), this.l1Bridge.address)
  }

  public async approve(
    l1Token: AddressLike,
    l2Token: AddressLike,
    amount: NumberLike,
    signer: Signer,
    opts?: {
      overrides?: Overrides
    }
  ): Promise<TransactionResponse> {
    return signer.sendTransaction(
      await this.populateTransaction.approve(l1Token, l2Token, amount, opts)
    )
  }

  public async deposit(
    l1Token: AddressLike,
    l2Token: AddressLike,
    amount: NumberLike,
    signer: Signer,
    opts?: {
      recipient?: AddressLike
      l2GasLimit?: NumberLike
      overrides?: Overrides
    }
  ): Promise<TransactionResponse> {
    return signer.sendTransaction(
      await this.populateTransaction.deposit(l1Token, l2Token, amount, opts)
    )
  }

  public async withdraw(
    l1Token: AddressLike,
    l2Token: AddressLike,
    amount: NumberLike,
    signer: Signer,
    opts?: {
      recipient?: AddressLike
      overrides?: Overrides
    }
  ): Promise<TransactionResponse> {
    return signer.sendTransaction(
      await this.populateTransaction.withdraw(l1Token, l2Token, amount, opts)
    )
  }

  populateTransaction = {
    approve: async (
      l1Token: AddressLike,
      l2Token: AddressLike,
      amount: NumberLike,
      opts?: {
        overrides?: Overrides
      }
    ): Promise<TransactionRequest> => {
      if (!(await this.supportsTokenPair(l1Token, l2Token))) {
        throw new Error(`token pair not supported by bridge`)
      }

      const token = new Contract(
        toAddress(l1Token),
        getContractInterface('L2StandardERC20'), // Any ERC20 will do
        this.messenger.l1Provider
      )

      return token.populateTransaction.approve(
        this.l1Bridge.address,
        amount,
        opts?.overrides || {}
      )
    },

    deposit: async (
      l1Token: AddressLike,
      l2Token: AddressLike,
      amount: NumberLike,
      opts?: {
        recipient?: AddressLike
        l2GasLimit?: NumberLike
        overrides?: Overrides
      }
    ): Promise<TransactionRequest> => {
      if (!(await this.supportsTokenPair(l1Token, l2Token))) {
        throw new Error(`token pair not supported by bridge`)
      }

      if (opts?.recipient === undefined) {
        return this.l1Bridge.populateTransaction.depositERC20(
          toAddress(l1Token),
          toAddress(l2Token),
          amount,
          opts?.l2GasLimit || 200_000, // Default to 200k gas limit.
          '0x', // No data.
          opts?.overrides || {}
        )
      } else {
        return this.l1Bridge.populateTransaction.depositERC20To(
          toAddress(l1Token),
          toAddress(l2Token),
          toAddress(opts.recipient),
          amount,
          opts?.l2GasLimit || 200_000, // Default to 200k gas limit.
          '0x', // No data.
          opts?.overrides || {}
        )
      }
    },

    withdraw: async (
      l1Token: AddressLike,
      l2Token: AddressLike,
      amount: NumberLike,
      opts?: {
        recipient?: AddressLike
        overrides?: Overrides
      }
    ): Promise<TransactionRequest> => {
      if (!(await this.supportsTokenPair(l1Token, l2Token))) {
        throw new Error(`token pair not supported by bridge`)
      }

      if (opts?.recipient === undefined) {
        return this.l2Bridge.populateTransaction.withdraw(
          toAddress(l2Token),
          amount,
          0, // L1 gas not required.
          '0x', // No data.
          opts?.overrides || {}
        )
      } else {
        return this.l2Bridge.populateTransaction.withdrawTo(
          toAddress(l2Token),
          toAddress(opts.recipient),
          amount,
          0, // L1 gas not required.
          '0x', // No data.
          opts?.overrides || {}
        )
      }
    },
  }

  estimateGas = {
    approve: async (
      l1Token: AddressLike,
      l2Token: AddressLike,
      amount: NumberLike,
      opts?: {
        overrides?: CallOverrides
      }
    ): Promise<BigNumber> => {
      return this.messenger.l1Provider.estimateGas(
        await this.populateTransaction.approve(l1Token, l2Token, amount, opts)
      )
    },

    deposit: async (
      l1Token: AddressLike,
      l2Token: AddressLike,
      amount: NumberLike,
      opts?: {
        recipient?: AddressLike
        l2GasLimit?: NumberLike
        overrides?: CallOverrides
      }
    ): Promise<BigNumber> => {
      return this.messenger.l1Provider.estimateGas(
        await this.populateTransaction.deposit(l1Token, l2Token, amount, opts)
      )
    },

    withdraw: async (
      l1Token: AddressLike,
      l2Token: AddressLike,
      amount: NumberLike,
      opts?: {
        recipient?: AddressLike
        overrides?: CallOverrides
      }
    ): Promise<BigNumber> => {
      return this.messenger.l2Provider.estimateGas(
        await this.populateTransaction.withdraw(l1Token, l2Token, amount, opts)
      )
    },
  }
}
