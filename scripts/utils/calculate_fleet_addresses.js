module.exports = function (web3, artifacts) {
  const GnosisSafeProxyFactory = artifacts.require("GnosisSafeProxyFactory")
  const { GnosisSafe } = require("./dependencies")(web3, artifacts)

  const { generateAddress2, toBuffer, bufferToHex } = require("ethereumjs-util")
  const { toBN, sha3 } = web3.utils

  const uint256Encode = (strNum) => {
    const bnNum = toBN(strNum)
    const bnHex = bnNum.toString(16)

    return `${"0".repeat(64 - bnHex.length)}${bnHex}`
  }

  const generateSafeAddress = (deployedByteCode, gnosisSafeTemplateAddress, proxyFactory, saltNonce, safeIndex) => {
    // Encode salt and safe index as padded uint256, the hashed result will be one part of the salt
    // used in the final address calculation
    const hexSaltNonceEncoded = uint256Encode(saltNonce)
    const hexSafeIndexEncoded = uint256Encode(safeIndex)
    const saltForBracket = sha3(`0x${hexSaltNonceEncoded}${hexSafeIndexEncoded}`)

    // Replicate salting like it was done in ProxyFactory:
    // `bytes32 salt = keccak256(abi.encodePacked(keccak256(initializer), saltNonce));`
    const hexInitEncoded = "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" // == sha3Raw("").slice(2) initializer we use is empty-string, only sha3Raw can handle it
    const hexSaltEncoded = uint256Encode(saltForBracket)
    const salt = sha3(`0x${hexInitEncoded}${hexSaltEncoded}`)

    // bytecode is "creation code" + left padded uint256 encoded address for the master safe template
    const hexCreationCode = deployedByteCode.slice(2)
    const hexSafeTemplateAddrEncoded = uint256Encode(gnosisSafeTemplateAddress)
    const byteCode = `0x${hexCreationCode}${hexSafeTemplateAddrEncoded}`

    // calculate the address that will be used for this index
    const safeAddress = generateAddress2(
      toBuffer(proxyFactory.address),
      toBuffer("0x" + uint256Encode(salt)),
      toBuffer(byteCode)
    )
    return web3.utils.toChecksumAddress(bufferToHex(safeAddress))
  }

  const calcSafeAddresses = async (
    bracketCount,
    saltNonce,
    fleetFactoryDeterministic = null,
    gnosisSafeTemplateAddress = null
  ) => {
    const proxyFactoryAddress =
      fleetFactoryDeterministic !== null ? await fleetFactoryDeterministic.proxyFactory() : GnosisSafeProxyFactory.address
    if (gnosisSafeTemplateAddress === null) {
      gnosisSafeTemplateAddress = GnosisSafe.address
    }

    const proxyFactory = await GnosisSafeProxyFactory.at(proxyFactoryAddress)

    // Retrieve the "creation code" of the proxy factory - needed in order to calculate the create2 addresses
    const deployedBytecode = await proxyFactory.proxyCreationCode()

    const safeAddresses = []
    for (let bracketIndex = 0; bracketIndex < bracketCount; bracketIndex++) {
      const safeAddress = generateSafeAddress(deployedBytecode, gnosisSafeTemplateAddress, proxyFactory, saltNonce, bracketIndex)
      safeAddresses.push(safeAddress)
    }
    return safeAddresses
  }

  return {
    calcSafeAddresses,
  }
}
