const utils = require("@gnosis.pm/safe-contracts/test/utils/general")
const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))
const TokenOWL = artifacts.require("TokenOWL")

const GnosisSafe = artifacts.require("./GnosisSafe.sol")
const ProxyFactory = artifacts.require("./GnosisSafeProxyFactory.sol")
const MultiSend = artifacts.require("./MultiSend.sol")

const ERC20 = artifacts.require("ERC20Detailed")
const MintableERC20 = artifacts.require("./ERC20Mintable")

const { waitForNSeconds, toETH, encodeMultiSend, execTransaction, execTransactionData, deploySafe } = require("./utils.js")

contract("GnosisSafe", function(accounts) {
  let lw
  let gnosisSafeMasterCopy
  let proxyFactory
  let testToken
  let exchange
  let multiSend

  const CALL = 0
  const DELEGATECALL = 1

  beforeEach(async function() {
    // Create lightwallet
    lw = await utils.createLightwallet()

    gnosisSafeMasterCopy = await GnosisSafe.new()
    console.log(gnosisSafeMasterCopy.address)
    proxyFactory = await ProxyFactory.new()
    multiSend = await MultiSend.new()
    testToken = await MintableERC20.new()

    BatchExchange.setProvider(web3.currentProvider)
    BatchExchange.setNetwork(web3.network_id)
    exchange = await BatchExchange.deployed()
    console.log("BatchExchange Address", exchange.address)
  })

  it("Adds tokens to the exchange", async () => {
    const owlToken = await TokenOWL.at(await exchange.feeToken())
    await owlToken.setMinter(accounts[0])
    await owlToken.mintOWL(accounts[0], toETH(10))
    await owlToken.approve(exchange.address, toETH(10))

    await exchange.addToken(testToken.address, { from: accounts[0] })
    assert.equal(await exchange.tokenAddressToIdMap(testToken.address), 1)
  })
  it("transfers tokens from fund account through trader accounts into exchange", async () => {
    const masterSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [lw.accounts[0], lw.accounts[1]], 2)
    console.log("Master Safe", masterSafe.address)
    const amount = 10000
    await testToken.mint(accounts[0], amount)
    await testToken.transfer(masterSafe.address, amount)
    const slaveSafes = []
    for (let i = 0; i < 2; i++) {
      const newSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [masterSafe.address], 1)
      slaveSafes.push(newSafe.address)
    }
    console.log("Slave Safes", slaveSafes)
    const transactions = []
    for (let index = 0; index < slaveSafes.length; index++) {
      const slaveSafe = slaveSafes[index]
      const tokenAmount = index + 2
      // Get data to move funds from master to slave
      const transferData = await testToken.contract.methods.transfer(slaveSafe, tokenAmount).encodeABI()
      transactions.push({
        operation: CALL,
        to: testToken.address,
        value: 0,
        data: transferData,
      })
      // Get data to approve funds from slave to exchange
      const approveData = await testToken.contract.methods.approve(exchange.address, tokenAmount).encodeABI()
      // Get data to deposit funds from slave to exchange
      const depositData = await exchange.contract.methods.deposit(testToken.address, tokenAmount).encodeABI()
      // Get data for approve and deposit multisend on slave
      const multiSendData = await encodeMultiSend(
        multiSend, [
          { operation: CALL, to: testToken.address, value: 0, data: approveData },
          { operation: CALL, to: exchange.address, value: 0, data: depositData },
        ])
      // Get data to execute approve/deposit multisend via slave
      const execData = await execTransactionData(gnosisSafeMasterCopy, masterSafe.address, multiSend.address, 0, multiSendData, 1)
      transactions.push({
        operation: CALL,
        to: slaveSafe,
        value: 0,
        data: execData,
      })
    }
    // Get data to execute all fund/approve/deposit transactions at once
    const finalData = await encodeMultiSend(multiSend, transactions)
    await execTransaction(masterSafe, lw, multiSend.address, 0, finalData, 1, "deposit for all slaves")
    await waitForNSeconds(301)

    for (let index = 0; index < slaveSafes.length; index++) {
      const slaveSafeAddress = slaveSafes[index]
      console.log(
        "Slave",
        index,
        "(",
        slaveSafeAddress,
        ") deposit:",
        await exchange.getBalance(slaveSafeAddress, testToken.address)
      )
      // This should always output 0 as the slaves should never directly hold funds
      console.log("Slave", index, "(", slaveSafeAddress, ") balance:", await testToken.balanceOf(slaveSafeAddress))
    }
  })
})
