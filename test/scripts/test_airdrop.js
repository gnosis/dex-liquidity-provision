const assert = require("assert")
const BN = require("bn.js")

const MintableToken = artifacts.require("DetailedMintableToken")
const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")

const { deploySafe } = require("../test_utils")
const { buildTransferDataFromList } = require("../../scripts/utils/trading_strategy_helpers")(web3, artifacts)
const { execTransaction } = require("../../scripts/utils/internals")(web3, artifacts)
const { toErc20Units } = require("../../scripts/utils/printing_tools")
const GAS_CAP = 4000000

contract("buildTransferDataFromList (a.k.a. Airdrop Token Transfer)", function (accounts) {
  let gnosisSafeMasterCopy
  let proxyFactory
  const safeOwner = accounts[0]
  beforeEach(async function () {
    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()
  })

  describe("Basic Transfers", () => {
    it("transfers one token to two different accounts", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const token = await MintableToken.new("GNO", 18)
      const tokenDecimals = await token.decimals.call()
      // TODO - this function only accepts strings!
      const mintAmount = toErc20Units("3", tokenDecimals)
      await token.mint(masterSafe.address, mintAmount)

      const transferList = [
        {
          amount: 1,
          tokenAddress: token.address,
          receiver: accounts[1],
        },
        {
          amount: 2,
          tokenAddress: token.address,
          receiver: accounts[2],
        },
      ]

      const transaction = await buildTransferDataFromList(masterSafe.address, transferList)
      await execTransaction(masterSafe, safeOwner, transaction)

      assert((await token.balanceOf(accounts[1])).eq(toErc20Units(1, tokenDecimals)))
      assert((await token.balanceOf(accounts[2])).eq(toErc20Units(2, tokenDecimals)))
    })
    it("transfers one token to two different accounts with useWei == true", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const token = await MintableToken.new("GNO", 18)
      await token.mint(masterSafe.address, 3)

      const transferList = [
        {
          amount: 1,
          tokenAddress: token.address,
          receiver: accounts[1],
        },
        {
          amount: 2,
          tokenAddress: token.address,
          receiver: accounts[2],
        },
      ]

      const transaction = await buildTransferDataFromList(masterSafe.address, transferList, true)
      await execTransaction(masterSafe, safeOwner, transaction)

      assert.equal((await token.balanceOf(accounts[1])).toString(), "1")
      assert.equal((await token.balanceOf(accounts[2])).toString(), "2")
    })
    it("transfers two different tokens to two different accounts", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const tokenA = await MintableToken.new("GNO", 18)
      const tokenB = await MintableToken.new("XYZ", 10)
      const tokenADecimals = await tokenA.decimals.call()
      const tokenBDecimals = await tokenB.decimals.call()
      // Mint necessary tokens.
      await tokenA.mint(masterSafe.address, toErc20Units("3", tokenADecimals))
      await tokenB.mint(masterSafe.address, toErc20Units("7", tokenBDecimals))

      const transferList = [
        {
          amount: 1,
          tokenAddress: tokenA.address,
          receiver: accounts[1],
        },
        {
          amount: 2,
          tokenAddress: tokenA.address,
          receiver: accounts[2],
        },
        {
          amount: 3,
          tokenAddress: tokenB.address,
          receiver: accounts[3],
        },
        {
          amount: 4,
          tokenAddress: tokenB.address,
          receiver: accounts[4],
        },
      ]

      const transaction = await buildTransferDataFromList(masterSafe.address, transferList)
      await execTransaction(masterSafe, safeOwner, transaction)

      assert((await tokenA.balanceOf(accounts[1])).eq(toErc20Units(1, tokenADecimals)))
      assert((await tokenA.balanceOf(accounts[2])).eq(toErc20Units(2, tokenADecimals)))
      assert((await tokenB.balanceOf(accounts[3])).eq(toErc20Units(3, tokenBDecimals)))
      assert((await tokenB.balanceOf(accounts[4])).eq(toErc20Units(4, tokenBDecimals)))
    })
  })
  describe("Failed Execution", () => {
    it("transfers one token to two different accounts", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const token = await MintableToken.new("FOO", 2)
      // No need to mint tokens, because the transfer data can't be built

      const transferList = [
        {
          amount: 3.1415926535,
          tokenAddress: token.address,
          receiver: accounts[1],
        },
      ]

      await assert.rejects(buildTransferDataFromList(masterSafe.address, transferList), {
        message: "Too many decimals for the token in input string",
      })
    })
    it("fails to build transfer data with insufficient funds", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const token = await MintableToken.new("FOO", 2)
      // No need to mint tokens, because the transfer data can't be built

      const transferList = [
        {
          amount: 1,
          tokenAddress: token.address,
          receiver: accounts[1],
        },
      ]

      await assert.rejects(buildTransferDataFromList(masterSafe.address, transferList), {
        message: "Master Safe has insufficient FOO balance (0 < 100)",
      })
    })
  })
  describe("Block Gas Limits", () => {
    it("transfers 1 token to one user 200 times.", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const token = await MintableToken.new("GNO", 18)
      const numTransfers = 200
      const transferAmount = 1

      await token.mint(masterSafe.address, numTransfers * transferAmount)

      const transferList = Array(numTransfers).fill({
        amount: transferAmount,
        tokenAddress: token.address,
        receiver: accounts[1],
      })
      const transaction = await buildTransferDataFromList(masterSafe.address, transferList, true)

      // TODO - estimate gas before execTransaction
      // const gasEstimate = await estimateGas(masterSafe.address, transaction)
      // assert(gasEstimate < blockGasLimit / 2)
      const executedTx = await execTransaction(masterSafe, safeOwner, transaction)
      assert(executedTx.receipt.gasUsed < GAS_CAP)
      assert((await token.balanceOf(accounts[1])).eq(new BN(numTransfers * transferAmount)))
    })
    it("transfers 1 token to one user 218 times.", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const token = await MintableToken.new("GNO", 18)
      const numTransfers = 218
      const transferAmount = 1

      await token.mint(masterSafe.address, numTransfers * transferAmount)

      const transferList = Array(numTransfers).fill({
        amount: transferAmount,
        tokenAddress: token.address,
        receiver: accounts[1],
      })
      const transaction = await buildTransferDataFromList(masterSafe.address, transferList, true)

      const executedTx = await execTransaction(masterSafe, safeOwner, transaction)
      console.log(executedTx.receipt.gasUsed)
      // assert(executedTx.receipt.gasUsed < GAS_CAP)
      assert((await token.balanceOf(accounts[1])).eq(new BN(numTransfers * transferAmount)))
    })
    it("Ensures no partial transfers happen on execution failure", async () => {
      const masterSafe = await GnosisSafe.at(await deploySafe(gnosisSafeMasterCopy, proxyFactory, [safeOwner], 1))
      const token = await MintableToken.new("GNO", 18)
      // Only mint enough for the first transfer.
      await token.mint(masterSafe.address, 1)

      const transferList = [
        {
          amount: 1,
          tokenAddress: token.address,
          receiver: accounts[1],
        },
        {
          amount: 2,
          tokenAddress: token.address,
          receiver: accounts[2],
        },
      ]
      // Build transaction with unsafe mode enabled.
      const transaction = await buildTransferDataFromList(masterSafe.address, transferList, true, true)

      const executedTx = await execTransaction(masterSafe, safeOwner, transaction)

      assert.equal(executedTx.logs[0].event, "ExecutionFailure")
      assert((await token.balanceOf(masterSafe.address)).eq(new BN(1)))
      assert((await token.balanceOf(accounts[1])).eq(new BN(0)))
      assert((await token.balanceOf(accounts[2])).eq(new BN(0)))
    })
  })
})
