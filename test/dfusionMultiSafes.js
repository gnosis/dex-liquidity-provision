const utils = require("@gnosis.pm/safe-contracts/test/utils/general")
const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const TokenOWL = artifacts.require("TokenOWL")

const GnosisSafe = artifacts.require("./GnosisSafe.sol")
const ProxyFactory = artifacts.require("./GnosisSafeProxyFactory.sol")
const MultiSend = artifacts.require("./MultiSend.sol")

const MintableERC20 = artifacts.require("./ERC20Mintable")

const { deployFleetOfSafes, buildOrderTransactionData, transferApproveDeposit } = require("../scripts/trading_strategy_helpers")
const { waitForNSeconds, toETH, encodeMultiSend, execTransaction, execTransactionData, deploySafe } = require("./utils.js")

contract("GnosisSafe", function(accounts) {
  let lw
  let gnosisSafeMasterCopy
  let proxyFactory
  let testToken
  let exchange
  let multiSend

  const CALL = 0

  beforeEach(async function() {
    // Create lightwallet
    // TODO - can we just use accounts provided by ganache?
    lw = await utils.createLightwallet()

    gnosisSafeMasterCopy = await GnosisSafe.new()
    proxyFactory = await ProxyFactory.new()
    multiSend = await MultiSend.deployed()
    testToken = await MintableERC20.new()

    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    exchange = await BatchExchange.deployed()
  })

  it("Adds tokens to the exchange", async () => {
    const owlToken = await TokenOWL.at(await exchange.feeToken())
    await owlToken.setMinter(accounts[0])
    await owlToken.mintOWL(accounts[0], toETH(10))
    await owlToken.approve(exchange.address, toETH(10))

    await exchange.addToken(testToken.address, { from: accounts[0] })
    assert.equal(await exchange.tokenAddressToIdMap(testToken.address), 1)
  })

  it("Deploys Fleet of Gnosis Safes", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
    const fleet = await deployFleetOfSafes(masterSafe.address, 10)
    assert.equal(fleet.length, 10)
    for (const slaveAddress of fleet) {
      const slaveSafe = await GnosisSafe.at(slaveAddress)
      const slaveOwners = await slaveSafe.getOwners()
      assert.equal(slaveOwners.length, 1, `Slave has unexpected number of owners ${slaveOwners.length}`)
      assert.equal(slaveOwners[0], masterSafe.address, "Expected Slave to have master safe as owner")
    }
  })

  it("transfers tokens from fund account through trader accounts and into exchange", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
    const slaveSafes = await deployFleetOfSafes(masterSafe.address, 2)
    const depositAmount = 1000
    await testToken.mint(accounts[0], depositAmount * slaveSafes.length)
    await testToken.transfer(masterSafe.address, depositAmount * slaveSafes.length)
    // Note that we are have NOT registered the tokens on the exchange but can deposit them nontheless.

    const deposits = slaveSafes.map(slaveAddress => (
      {
        amount: depositAmount,
        tokenAddress: testToken.address,
        userAddress: slaveAddress,
      }
    ))
    
    const batchedTransactions = await transferApproveDeposit(masterSafe, deposits)
    assert.equal(batchedTransactions.to, multiSend.address)

    await execTransaction(masterSafe, lw, multiSend.address, 0, batchedTransactions.data, 1)
    // Close auction for deposits to be refelcted in exchange balance
    await waitForNSeconds(301)

    for (let index = 0; index < slaveSafes.length; index++) {
      const slaveAddress = slaveSafes[index]
      const slaveExchangeBalance = (await exchange.getBalance(slaveAddress, testToken.address)).toNumber()
      assert.equal(slaveExchangeBalance, depositAmount)
      const slavePersonalTokenBalance = (await testToken.balanceOf(slaveAddress)).toNumber()
      // This should always output 0 as the slaves should never directly hold funds
      assert.equal(slavePersonalTokenBalance, 0)
    }
  })
})
