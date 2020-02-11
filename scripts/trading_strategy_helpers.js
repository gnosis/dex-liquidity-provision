const GnosisSafe = artifacts.require("./GnosisSafe.sol")
const ProxyFactory = artifacts.require("./GnosisSafeProxyFactory.sol")
const ERC20 = artifacts.require("ERC20Detailed")

const Contract = require("@truffle/contract")
const BatchExchange = Contract(require("@gnosis.pm/dex-contracts/build/contracts/BatchExchange"))

const BN = require("bn.js")
const { deploySafe } = require("../test/utils")

const maxU32 = 2 ** 32 - 1

const formatAmount = function(amount, token) {
  return new BN(10).pow(new BN(token.decimals)).muln(amount)
}

const fetchTokenInfo = async function(contract, tokenIds) {
  console.log("Fetching token data from EVM")
  const tokenObjects = {}
  for (const id of tokenIds) {
    const tokenAddress = await contract.tokenIdToAddressMap(id)
    const tokenInstance = await ERC20.at(tokenAddress)
    const tokenInfo = {
      id: id,
      symbol: await tokenInstance.symbol.call(),
      decimals: (await tokenInstance.decimals.call()).toNumber(),
    }
    tokenObjects[id] = tokenInfo
    console.log(`Found Token ${tokenInfo.symbol} at ID ${tokenInfo.id} with ${tokenInfo.decimals} decimals`)
  }
  return tokenObjects
}

const deployFleetOfSafes = async function(fleetOwner, fleetSize) {
  const proxyFactory = await ProxyFactory.deployed()
  const gnosisSafeMasterCopy = await GnosisSafe.deployed()

  // TODO - Batch all of this in a single transaction
  const slaveSafes = []
  for (let i = 0; i < fleetSize; i++) {
    const newSafe = await deploySafe(gnosisSafeMasterCopy, proxyFactory, [fleetOwner], 1)
    slaveSafes.push(newSafe.address)
  }

  return slaveSafes
}

const buildOrderTransactionData = async function(
  fleetOwnerAddress,
  subSafeAddresses,
  targetTokenId,
  stableTokenId,
  targetPrice,
  priceRangePercentage=20,
  validFrom=3,
  expiry=maxU32
) {
  // number of brackets is determined by subsafeAddresses.length
  const exchange = await BatchExchange.deployed()
  const tokenInfo = await fetchTokenInfo(exchange, [targetTokenId, stableTokenId])

  const targetToken = tokenInfo[targetTokenId]
  const stableToken = tokenInfo[stableTokenId]
  // TODO - handle other cases later.
  assert(stableToken.decimals === 18, "Bracket tokens must have 18 decimals")
  assert(targetToken.decimals === 18, "Bracket tokens must have 18 decimals")

  const lowestLimit = targetPrice * (1 - priceRangePercentage / 100)
  const highestLimit = targetPrice * (1 - priceRangePercentage / 100)
  const stepSize = (highestLimit - lowestLimit) / subSafeAddresses.length

  let safeIndex = 0
  for (let lowerLimit=lowestLimit; lowerLimit < highestLimit; lowerLimit+=stepSize) {
    const userAddress = subSafeAddresses[safeIndex]
    
    const upperLimit = lowerLimit + stepSize
    
    // Sell targetToken for stableToken at targetTokenPrice = upperLimit
    // Sell 1 ETH at for 102 DAI (unlimited)
    // Sell x ETH for maxU32 DAI 
    // x = maxU32 / 102
    const sellPrice = formatAmount(upperLimit, targetToken)
    const upperSellAmount = maxU32.div(sellPrice)
    const upperBuyAmount = maxU32
    console.log(`Account ${userAddress}: Sell ${targetToken.symbol} for ${stableToken.symbol} at ${sellPrice}`)
    


    // Sell stableToken for targetToken in at targetTokenPrice = lowerLimit
    // Buy ETH at 101 for DAI (unlimited)
    // Sell 101 DAI for 1 ETH
    // Sell maxU32 DAI for x ETH
    // x = maxU32 / 101
    const buyPrice = formatAmount(lowerLimit, targetToken)
    const lowerSellAmount = maxU32
    const lowerBuyAmount = maxU32.div(buyPrice)
    console.log(`Account ${userAddress}: Buy ${targetToken.symbol} with ${stableToken.symbol} at ${buyPrice}`)
    
    safeIndex += 1
  }

}

// const transferApproveDeposit = async function(fleetOwner, subSafes, depositData) {
//   const exchange = await BatchExchange.deployed()
//   const tokenData = await fetchTokenInfo(exchange, tokenIds)

//   const transactions = []
//   for (let index = 0; index < subSafes.length; index++) {
//     const slaveSafe = subSafes[index]
//     const tokenAmount = index + 2
//     // Get data to move funds from master to slave
//     const transferData = await testToken.contract.methods.transfer(slaveSafe, tokenAmount).encodeABI()
//     transactions.push({
//       operation: CALL,
//       to: testToken.address,
//       value: 0,
//       data: transferData,
//     })
//     // Get data to approve funds from slave to exchange
//     const approveData = await testToken.contract.methods.approve(exchange.address, tokenAmount).encodeABI()
//     // Get data to deposit funds from slave to exchange
//     const depositData = await exchange.contract.methods.deposit(testToken.address, tokenAmount).encodeABI()
//     // Get data for approve and deposit multisend on slave
//     const multiSendData = await encodeMultiSend(multiSend, [
//       { operation: CALL, to: testToken.address, value: 0, data: approveData },
//       { operation: CALL, to: exchange.address, value: 0, data: depositData },
//     ])
//     // Get data to execute approve/deposit multisend via slave
//     const execData = await execTransactionData(gnosisSafeMasterCopy, masterSafe.address, multiSend.address, 0, multiSendData, 1)
//     transactions.push({
//       operation: CALL,
//       to: slaveSafe,
//       value: 0,
//       data: execData,
//     })
//   }
//   // Get data to execute all fund/approve/deposit transactions at once
//   const finalData = await encodeMultiSend(multiSend, transactions)
// }

module.exports = {
  deployFleetOfSafes,
}
