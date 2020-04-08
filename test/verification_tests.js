const assert = require("assert")
const BN = require("bn.js")
const utils = require("@gnosis.pm/safe-contracts/test/utils/general")
const exchangeUtils = require("@gnosis.pm/dex-contracts")
const Contract = require("@truffle/contract")
const { prepareTokenRegistration, addCustomMintableTokenToExchange } = require("./test-utils")
const { isPriceReasonable, checkNoProfitableOffer } = require("../scripts/utils/price-utils")(web3, artifacts)
const ERC20 = artifacts.require("DetailedMintableToken")
const { deploySafe } = require("./test-utils")
const { waitForNSeconds, execTransaction } = require("../scripts/utils/internals")(web3, artifacts)

const assertThrows = require("assert-throws-async")
const GnosisSafe = artifacts.require("GnosisSafe")
const ProxyFactory = artifacts.require("GnosisSafeProxyFactory")
const {
  fetchTokenInfoFromExchange,
  fetchTokenInfoAtAddresses,
  deployFleetOfSafes,
  buildOrders,
  buildTransferApproveDepositFromList,
  buildTransferApproveDepositFromOrders,
  buildRequestWithdraw,
  buildWithdraw,
  buildTransferFundsToMaster,
  buildWithdrawAndTransferFundsToMaster,
  isOnlySafeOwner,
  max128,
  maxU32,
} = require("../scripts/utils/trading_strategy_helpers")(web3, artifacts)
const FleetFactory = artifacts.require("FleetFactory")

contract("Verification scripts", function(accounts) {
  let exchange
  let lw
  let gnosisSafeMasterCopy
  let proxyFactory
  let fleetFactory
  beforeEach(async function() {
    // Create lightwallet
    // TODO - can we just use accounts provided by ganache?
    lw = await utils.createLightwallet()

    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()
    fleetFactory = await FleetFactory.new(proxyFactory.address)
    const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    exchange = await BatchExchange.deployed()
  })
  const { verifyCorrectSetup } = require("../scripts/utils/verify-scripts")(web3, artifacts)
  const decodeCreateProxy = function(rawEvent) {
    const { data, topics } = rawEvent
    const eventSignature = web3.eth.abi.encodeEventSignature("ProxyCreation(address)")
    assert.equal(topics[0], eventSignature, "Input raw event is not a CreateProxy event")
    const decoded = web3.eth.abi.decodeLog(
      [
        {
          type: "address",
          name: "proxy",
        },
      ],
      data,
      topics
    )
    return decoded.proxy
  }
  describe("1 constraint: Owner is master safe", async () => {
    it.only("throws if the masterSafe is not the only owner", async () => {
      const notMasterSafeAddress = accounts[8]
      const masterSafe = await GnosisSafe.at(
        await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
      )
      const bracketAddresses = await deployFleetOfSafes(masterSafe, 1)

      const targetToken = (await addCustomMintableTokenToExchange(exchange, "WETH", 18, accounts[0])).id
      const stableToken = (await addCustomMintableTokenToExchange(exchange, "DAI", 18, accounts[0])).id

      const lowestLimit = 90
      const highestLimit = 120

      const transaction = await buildOrders(
        masterSafe.address,
        bracketAddresses,
        targetToken,
        stableToken,
        lowestLimit,
        highestLimit
      )
      await execTransaction(masterSafe, lw, transaction)

      //
      await (await GnosisSafe.at(bracketAddresses[0])).assertThrows(
        await verifyCorrectSetup(bracketAddresses, masterSafe, []),
        "AssertionError [ERR_ASSERTION]: isOnlySafeOwner throws"
      )
    })
  })
  describe("2 constraint: Owner is master safe", async () => {
    it("throws if the proxy contract is not gnosis safe template", async () => {})
  })
  describe("3 constraint: Throws if two orders are profitable to trade against each other", async () => {
    it("throws if the proxy contract is not gnosis safe template", async () => {})
  })
})
