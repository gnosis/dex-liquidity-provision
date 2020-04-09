const assert = require("assert")
const BN = require("bn.js")
const utils = require("@gnosis.pm/safe-contracts/test/utils/general")
const Contract = require("@truffle/contract")
const { deploySafe } = require("./test-utils")
const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")
const { verifyCorrectSetup } = require("../scripts/utils/verify-scripts")(web3, artifacts)
const { addCustomMintableTokenToExchange } = require("./test-utils")
const {
  deployFleetOfSafes,
  buildOrders,
  buildTransferApproveDepositFromOrders,
} = require("../scripts/utils/trading_strategy_helpers")(web3, artifacts)
const { execTransaction } = require("../scripts/utils/internals")(web3, artifacts)

contract("Verification scripts", function(accounts) {
  let exchange
  let lw
  let gnosisSafeMasterCopy
  let proxyFactory
  let targetToken
  let stableToken
  beforeEach(async function() {
    // Create lightwallet
    // TODO - can we just use accounts provided by ganache?
    lw = await utils.createLightwallet()

    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    exchange = await BatchExchange.deployed()

    targetToken = (await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])).id
    stableToken = (await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])).id
    await exchange.placeOrder(targetToken, stableToken, 1234124, 11241234, 11234234, { from: accounts[0] })
  })
  describe("1 constraint: Owner is master safe", async () => {
    it("throws if the masterSafe is not the only owner", async () => {
      const notMasterSafeAddress = accounts[8]
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const notOwnedBracket = await deployFleetOfSafes(notMasterSafeAddress, 1)
      await assert.rejects(verifyCorrectSetup(notOwnedBracket, masterSafe.address, []), {
        message: "owners are not set correctly",
      })
    })
  })
  describe("2 constraint: MasterCopy is usual GnosisSafeMasterCopy", async () => {
    it("throws if the proxy contract is not gnosis safe template", async () => {
      const notMasterCopy = await GnosisSafe.new()
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const notOwnedBracket = [(await deploySafe(notMasterCopy, proxyFactory, [masterSafe.address], 1)).toLowerCase()]
      await assert.rejects(verifyCorrectSetup(notOwnedBracket, masterSafe.address, []), {
        message: "MasterCopy not set correctly",
      })
    })
  })
  describe("3 constraint: Throws if a bracket does not have two orders", async () => {
    it("throws if the proxy contract is not gnosis safe template", async () => {
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2)
      const targetToken = (await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])).id
      const stableToken = (await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])).id
      const lowestLimit = 90
      const highestLimit = 120
      //first round of order building
      const transaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken,
        stableToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, transaction)
      // second round of order building
      const transaction2 = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken,
        stableToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, transaction2)
      await assert.rejects(verifyCorrectSetup([bracketAddresses[0]], masterSafe.address, []), {
        message: "order length is not correct",
      })
    })
    // describe("4 constraint: Throws if two orders are profitable to trade against each other", async () => {
    //   it("throws if the proxy contract is not gnosis safe template", async () => {})
    // })
    // describe("5 constraint: Throws if there are profitable orders", async () => {
    //   it.only("throws if there are profitable orders", async () => {
    //     const masterSafe = await GnosisSafe.at(
    //       await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
    //     )
    //     const bracketAddresses = await deployFleetOfSafes(masterSafe.address, 2)
    //     const targetToken = (await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])).id
    //     const stableToken = (await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])).id
    //     const lowestLimit = 90
    //     const highestLimit = 120
    //     const currentPrice = 100
    //     const investmentStableToken = new BN("1100000000000000000000")
    //     const investmentTargetToken = new BN("1100000000000000000000")
    //     //first round of order building
    //     const transaction = await buildOrders(
    //       masterSafe.address,
    //       bracketAddresses,
    //       targetToken,
    //       stableToken,
    //       lowestLimit,
    //       highestLimit
    //     )
    //     await execTransaction(masterSafe, lw, transaction)
    //     const bundledFundingTransaction = await buildTransferApproveDepositFromOrders(
    //       masterSafe.address,
    //       bracketAddresses,
    //       targetToken.address,
    //       stableToken.address,
    //       lowestLimit,
    //       highestLimit,
    //       currentPrice,
    //       investmentStableToken,
    //       investmentTargetToken,
    //       true
    //     )
    //     await execTransaction(masterSafe, lw, bundledFundingTransaction)

    //     const globalPriceStorage = {}
    //     globalPriceStorage["DAI-USDC"] = 1.0
    //     globalPriceStorage["WETH-DAI"] = 1 //<-- completely off price that will make the one order seem like it would be selling at unresonable prices

    //     await assert.rejects(verifyCorrectSetup([bracketAddresses[0]], masterSafe.address, [], globalPriceStorage), {
    //       message: "tbd",
    //     })
    //   })
    // })
  })
})
