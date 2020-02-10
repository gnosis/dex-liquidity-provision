const utils = require('@gnosis.pm/safe-contracts/test/utils/general')
const Contract = require("@truffle/contract");
const BatchExchange = Contract(
    require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange")
)

const GnosisSafe = artifacts.require("./GnosisSafe.sol")
const ProxyFactory = artifacts.require("./GnosisSafeProxyFactory.sol")
const MultiSend = artifacts.require("./MultiSend.sol")
const MintableERC20 = artifacts.require("./ERC20Mintable")

const jsonrpc = "2.0"
const id = 0
const send = function(method, params, web3Provider) {
  return new Promise(function(resolve, reject) {
    web3Provider.currentProvider.send({ id, jsonrpc, method, params }, (error, result) => {
      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    })
  })
}

/**
 * Wait for n (evm) seconds to pass
 * @param seconds: int
 * @param web3Provider: potentially different in contract tests and system end-to-end testing.
 */
const waitForNSeconds = async function(seconds, web3Provider = web3) {
    await send("evm_increaseTime", [seconds], web3Provider)
    await send("evm_mine", [], web3Provider)
  }

contract('GnosisSafe', function(accounts) {
    let lw
    let gnosisSafeMasterCopy
    let proxyFactory
    let testToken
    let exchange
    let multiSend

    const CALL = 0
    const DELEGATECALL = 1
    const ADDRESS_0 = "0x0000000000000000000000000000000000000000"

    beforeEach(async function() {
        // Create lightwallet
        lw = await utils.createLightwallet()

        gnosisSafeMasterCopy = await GnosisSafe.new()
        console.log(gnosisSafeMasterCopy.address)
        //console.log(gnosisSafeMasterCopy)
        proxyFactory = await ProxyFactory.new()
        multiSend = await MultiSend.new()
        testToken = await MintableERC20.new()
        
        BatchExchange.setProvider(web3.currentProvider)
        BatchExchange.setNetwork(web3.network_id)
        exchange = await BatchExchange.deployed()
        console.log("BatchExchange Address", exchange.address)
    })

    let execTransaction = async function(safe, to, value, data, operation, message) {
        let nonce = await safe.nonce()
        let transactionHash = await safe.getTransactionHash(to, value, data, operation, 0, 0, 0, ADDRESS_0, ADDRESS_0, nonce)
        let sigs = utils.signTransaction(lw, [lw.accounts[0], lw.accounts[1]], transactionHash)
        utils.logGasUsage(
            'execTransaction ' + message,
            await safe.execTransaction(to, value, data, operation, 0, 0, 0, ADDRESS_0, ADDRESS_0, sigs)
        )
    }

    let execTransactionData = async function(owner, to, value, data, operation = 0) {
        let sigs = "0x" + "000000000000000000000000" + owner.replace('0x', '') + "0000000000000000000000000000000000000000000000000000000000000000" + "01"
        return await gnosisSafeMasterCopy.contract.methods.execTransaction(
            to, value, data, operation, 0, 0, 0, ADDRESS_0, ADDRESS_0, sigs
        ).encodeABI()
    }

    let deploySafe = async function(owners, threshold) {
        //console.log("Deploy Safe for", owners)
        const initData = await gnosisSafeMasterCopy.contract.methods.setup(owners, threshold, ADDRESS_0, "0x", ADDRESS_0, ADDRESS_0, 0, ADDRESS_0).encodeABI()
        //console.log("Init data", initData)
        return await getParamFromTxEvent(
            await proxyFactory.createProxy(gnosisSafeMasterCopy.address, initData),
            'ProxyCreation', 'proxy', proxyFactory.address, GnosisSafe, "create Gnosis Safe"
        )
    }

    let encodeMultiSend = async function(txs) {
        return await multiSend.contract.methods.multiSend(
            `0x${txs.map((tx) => [
              web3.eth.abi.encodeParameter('uint8', tx.operation).slice(-2),
              web3.eth.abi.encodeParameter('address', tx.to).slice(-40),
              web3.eth.abi.encodeParameter('uint256', tx.value).slice(-64),
              web3.eth.abi.encodeParameter('uint256', web3.utils.hexToBytes(tx.data).length).slice(-64),
              tx.data.replace(/^0x/, ''),
            ].join('')).join('')}`,
          ).encodeABI()
    }

    it('transfers tokens from fund account through trader accounts into exchange', async () => {
        const masterSafe = await deploySafe([lw.accounts[0], lw.accounts[1]], 2)
        console.log("Master Safe", masterSafe.address)
        var amount = 10000
        await testToken.mint(accounts[0], amount)
        await testToken.transfer(masterSafe.address, amount)
        const slaveSafes = []
        for (let i = 0; i < 2; i++) {
            const newSafe = await deploySafe([masterSafe.address], 1)
            slaveSafes.push(newSafe.address)
        }
        console.log("Slave Safes", slaveSafes)
        const transactions = []
        for (let index = 0; index < slaveSafes.length; index++) {
            const slaveSafe = slaveSafes[index]
            const tokenAmount = index + 2
            // Get data to move funds from master to slave
            const transferData = await testToken.contract.methods.transfer(slaveSafe, tokenAmount).encodeABI()
            transactions.push({operation: CALL, to: testToken.address, value: 0, data: transferData})
            // Get data to approve funds from slave to exchange
            const approveData = await testToken.contract.methods.approve(exchange.address, tokenAmount).encodeABI()
            // Get data to deposit funds from slave to exchange
            const depositData = await exchange.contract.methods.deposit(testToken.address, tokenAmount).encodeABI()
            // Get data for approve and deposit multisend on slave
            const multiSendData = await encodeMultiSend([
                {operation: CALL, to: testToken.address, value: 0, data: approveData},
                {operation: CALL, to: exchange.address, value: 0, data: depositData}
            ])
            // Get data to execute approve/deposit multisend via slave
            const execData = await execTransactionData(masterSafe.address, multiSend.address, 0, multiSendData, 1)
            transactions.push({operation: CALL, to: slaveSafe, value: 0, data: execData})
        }
        // Get data to execute all fund/approve/deposit transactions at once
        const finalData = await encodeMultiSend(transactions)
        await execTransaction(masterSafe, multiSend.address, 0, finalData, 1, "deposit for all slaves")
        await waitForNSeconds(301)
        for (let index = 0; index < slaveSafes.length; index++) {
            const slaveSafeAddress = slaveSafes[index]
            console.log("Slave", index, "(", slaveSafeAddress, ") deposit:", await exchange.getBalance(slaveSafeAddress, testToken.address))
            // This should always output 0 as the slaves should never directly hold funds
            console.log("Slave", index, "(", slaveSafeAddress, ") balance:", await testToken.balanceOf(slaveSafeAddress))
        }
    })

    // Need some small adjustments to default implementation for web3js 1.x
    async function getParamFromTxEvent(transaction, eventName, paramName, contract, contractFactory, subject) {
        assert.isObject(transaction)
        if (subject != null) {
            utils.logGasUsage(subject, transaction)
        }
        let logs = transaction.logs
        if(eventName != null) {
            logs = logs.filter((l) => l.event === eventName && l.address === contract)
        }
        assert.equal(logs.length, 1, 'too many logs found!')
        let param = logs[0].args[paramName]
        if(contractFactory != null) {
            // Adjustment: add await
            let contract = await contractFactory.at(param)
            assert.isObject(contract, `getting ${paramName} failed for ${param}`)
            return contract
        } else {
            return param
        }
    }
})