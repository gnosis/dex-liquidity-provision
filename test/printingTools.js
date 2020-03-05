// This test can be run directly using mocha:
// $ npx mocha test/printingTools.js
// Using truffle test works but it's much slower, since it needs to compile contracts and deploy them to the blockchain.

const BN = require("bn.js")
const assert = require("assert")

const {
  fromUserToMachineReadable,
  fromMachineToUserReadable,
  bnMaxUint,
  bnOne,
} = require("../scripts/utils/printing_tools")

const goodTwoWayPairs = [
  {
    user: "1.1",
    machine: "1100",
    decimals: 3
  },
  {
    user: "0.01",
    machine: "100",
    decimals: 4
  },
  {
    user: "1",
    machine: "100",
    decimals: 2
  },
  {
    user: "104",
    machine: "104",
    decimals: 0
  },
  {
    user: "0.002901",
    machine: "2901000000000000",
    decimals: 18
  },
  {
    user: "1.002901",
    machine: "1002901000000000000",
    decimals: 18
  },
  {
    user: "0." + bnMaxUint.toString().padStart(255, "0"),
    machine: bnMaxUint.toString(),
    decimals: 255
  },
  {
    user: bnMaxUint.toString(),
    machine: bnMaxUint.toString(),
    decimals: 0
  },
  {
    user: bnMaxUint.toString().slice(0, -18) + "." + bnMaxUint.toString().slice(-18),
    machine: bnMaxUint.toString(),
    decimals: 18,
  },
  {
    user: "0",
    machine: "0",
    decimals: 0
  },
  {
    user: "0",
    machine: "0",
    decimals: 18
  },
  {
    user: "0",
    machine: "0",
    decimals: 255
  }
]

describe("fromUserToMachineReadable", () => {
  const invalidDecimals = function (decimals) { return "Invalid number of decimals for ERC20 token: " + decimals.toString() }
  const invalidNumber = function (amount) { return "Failed to parse decimal representation of " + amount }
  const tooManyDecimals = function () { return "Too many decimals for the token in input string" }
  const tooLargeNumber = function () { return "Number larger than ERC20 token maximum amount" }

  const testGoodEntries = function (entries) {
    for (const {user, machine, decimals} of entries) {
      assert.equal(
        fromUserToMachineReadable(user, decimals),
        machine,
        "Fail for user string " + user
      )
    }
  }
  const testBadEntries = function (entries) {
    for (const {user, decimals, error} of entries) {
      let errorMessage
      switch (error) {
        case "invalidDecimals":
          errorMessage = invalidDecimals(decimals)
          break
        case "invalidNumber":
          errorMessage = invalidNumber(user)
          break
        case "tooManyDecimals":
          errorMessage = tooManyDecimals()
          break
        case "tooLargeNumber":
          errorMessage = tooLargeNumber()
          break
        default:
          throw Error("Invalid error to test")
      }
      assert.throws(
        function () { return fromUserToMachineReadable(user, decimals) },
        Error,
        errorMessage
      )
    }
  }
  it("works as expected with reasonable input", () => {
    testGoodEntries(goodTwoWayPairs)
  })
  it("fails with bad input", () => {
    const badEntries = [
      {
        user: "0",
        decimals: -1,
        error: "invalidDecimals",
      },
      {
        user: "0",
        decimals: 256,
        error: "invalidDecimals",
      },
      {
        user: "0",
        decimals: 1000,
        error: "invalidDecimals",
      },
      {
        user: "0,1",
        decimals: 18,
        error: "invalidNumber",
      },
      {
        user: "0.",
        decimals: 8,
        error: "invalidNumber",
      },
      {
        user: ".0",
        decimals: 2,
        error: "invalidNumber",
      },
      {
        user: "number",
        decimals: 10,
        error: "invalidNumber",
      },
      {
        user: "2..2",
        decimals: 42,
        error: "invalidNumber",
      },
      {
        user: "0x300",
        decimals: 200,
        error: "invalidNumber",
      },
      {
        user: "true",
        decimals: 1,
        error: "invalidNumber",
      },
      {
        user: "2+2",
        decimals: 81,
        error: "invalidNumber",
      },
      {
        user: "2.2.2",
        decimals: 12,
        error: "invalidNumber",
      },
      {
        user: "0.333",
        decimals: 2,
        error: "tooManyDecimals",
      },
      {
        user: "0.000",
        decimals: 2,
        error: "tooManyDecimals",
      },
      {
        user: "0.0",
        decimals: 0,
        error: "tooManyDecimals",
      },
      {
        user: "0." + "".padEnd(256, "0"),
        decimals: 255,
        error: "tooManyDecimals",
      },
      {
        user: bnMaxUint.add(bnOne).toString(),
        decimals: 0,
        error: "tooLargeNumber",
      },
      {
        user: "0." + bnMaxUint.add(bnOne).toString().padStart(255, "0"),
        decimals: 255,
        error: "tooLargeNumber",
      },
      {
        user: bnMaxUint.add(bnOne).toString().slice(0, -18) + "." + bnMaxUint.add(bnOne).toString().slice(-18),
        decimals: 18,
        error: "tooLargeNumber",
      },
    ]
    testBadEntries(badEntries)
  })
})

describe("fromMachineToUserReadable", () => {
  const testGoodEntries = function (entries) {
    for (const {user, machine, decimals} of entries) {
      assert.equal(
        fromMachineToUserReadable(machine, decimals),
        user,
        "Fail for user string " + user
      )
    }
  }
  it("works as expected with reasonable input", () => {
    testGoodEntries(goodTwoWayPairs)
  })
})
