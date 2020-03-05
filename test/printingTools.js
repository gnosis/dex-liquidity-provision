// This test can be run directly using mocha:
// $ npx mocha test/printingTools.js
// Using truffle test works but it's much slower, since it needs to compile contracts and deploy them to the blockchain.

const BN = require("bn.js")
const assert = require("assert")

const {
  fromUserToMachineReadable,
  fromMachineToUserReadable,
} = require("../scripts/utils/printing_tools")

const goodPairs = [
  {
    user: "1.1",
    machine: "1100",
    digits: 3
  },
  {
    user: "0.01",
    machine: "100",
    digits: 4
  },
  {
    user: "1",
    machine: "100",
    digits: 2
  },
  {
    user: "104",
    machine: "104",
    digits: 0
  },
  {
    user: "0.002901",
    machine: "2901000000000000",
    digits: 18
  },
  {
    user: "1.002901",
    machine: "1002901000000000000",
    digits: 18
  }
]

describe("fromUserToMachineReadable", () => {
  it("works as expected with reasonable input", () => {
    for (const {user, machine, digits} of goodPairs) {
      assert.equal(
        fromUserToMachineReadable(user, digits),
        machine,
        "Fail for user string " + user
      )
    }
  })
})

describe("fromMachineToUserReadable", () => {
  it("works as expected with reasonable input", () => {
    for (const {user, machine, digits} of goodPairs) {
      assert.equal(
        fromMachineToUserReadable(machine, digits),
        user,
        "Fail for unit amount " + machine
      )
    }
  })
})
