pragma solidity ^0.5.0;

// NOTE:
//  This file's purpose is just to make sure truffle compiles all of depending
//  contracts during development.
//
//  For other environments, only use compiled contracts from the NPM package.
// Token Dependencies
import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import "@gnosis.pm/owl-token/contracts/TokenOWLProxy.sol";
import "@gnosis.pm/owl-token/contracts/TokenOWL.sol";
// Batch Exchange dependencies
import "@gnosis.pm/solidity-data-structures/contracts/libraries/IdToAddressBiMap.sol";
import "@gnosis.pm/solidity-data-structures/contracts/libraries/IterableAppendOnlySet.sol";
import "@gnosis.pm/dex-contracts/contracts/BatchExchange.sol";
// Gnosis Safe dependencies
import "@gnosis.pm/safe-contracts/contracts/libraries/MultiSend.sol";
import "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxy.sol";
