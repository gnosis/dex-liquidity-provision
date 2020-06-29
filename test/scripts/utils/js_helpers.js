// For faster execution, this test can be run directly using mocha:
// $ npx mocha path/to/test/file.js

const assert = require("assert")

const { sleep, returnFirstNotErroring } = require("../../../scripts/utils/js_helpers")

describe("returnFirstNotErroring", () => {
  const sleepForAndReturn = async (ms) => {
    await sleep(ms)
    return ms
  }
  const sleepForAndError = async (ms) => {
    await sleep(ms)
    throw new Error(ms)
  }
  const sleepForAndReject = async (ms) => {
    await sleep(ms)
    throw ms
  }
  it("resolves returning first resolved promise", async () => {
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(10), sleepForAndReturn(20), sleepForAndReturn(30)]), 10)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(10), sleepForAndReturn(30), sleepForAndReturn(20)]), 10)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(20), sleepForAndReturn(10), sleepForAndReturn(30)]), 10)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(20), sleepForAndReturn(30), sleepForAndReturn(10)]), 10)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(30), sleepForAndReturn(10), sleepForAndReturn(20)]), 10)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(30), sleepForAndReturn(20), sleepForAndReturn(10)]), 10)
  })
  it("fails with empty array", async () => {
    // it would be nice to also test that the returned promise is already fulfilled, as per specifications of Promise.any
    // however it's apparently not possible to check the promise state from the code:
    // https://developer.mozilla.org/en-US/docs/Mozilla/JavaScript_code_modules/Promise.jsm/Promise#Debugging
    const result = returnFirstNotErroring([])
    assert(result instanceof Promise)
    await assert.rejects(result)
  })
  it("resolves even if some promises error out", async () => {
    // one error
    assert.equal(await returnFirstNotErroring([sleepForAndError(10), sleepForAndReturn(20), sleepForAndReturn(30)]), 20)
    assert.equal(await returnFirstNotErroring([sleepForAndError(10), sleepForAndReturn(30), sleepForAndReturn(20)]), 20)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(20), sleepForAndError(10), sleepForAndReturn(30)]), 20)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(20), sleepForAndReturn(30), sleepForAndError(10)]), 20)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(30), sleepForAndError(10), sleepForAndReturn(20)]), 20)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(30), sleepForAndReturn(20), sleepForAndError(10)]), 20)
    // two errors
    assert.equal(await returnFirstNotErroring([sleepForAndError(10), sleepForAndError(20), sleepForAndReturn(30)]), 30)
    assert.equal(await returnFirstNotErroring([sleepForAndError(10), sleepForAndReturn(30), sleepForAndError(20)]), 30)
    assert.equal(await returnFirstNotErroring([sleepForAndError(20), sleepForAndError(10), sleepForAndReturn(30)]), 30)
    assert.equal(await returnFirstNotErroring([sleepForAndError(20), sleepForAndReturn(30), sleepForAndError(10)]), 30)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(30), sleepForAndError(10), sleepForAndError(20)]), 30)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(30), sleepForAndError(20), sleepForAndError(10)]), 30)
  })
  it("resolves even if some promises reject", async () => {
    // one error
    assert.equal(await returnFirstNotErroring([sleepForAndReject(10), sleepForAndReturn(20), sleepForAndReturn(30)]), 20)
    assert.equal(await returnFirstNotErroring([sleepForAndReject(10), sleepForAndReturn(30), sleepForAndReturn(20)]), 20)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(20), sleepForAndReject(10), sleepForAndReturn(30)]), 20)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(20), sleepForAndReturn(30), sleepForAndReject(10)]), 20)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(30), sleepForAndReject(10), sleepForAndReturn(20)]), 20)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(30), sleepForAndReturn(20), sleepForAndReject(10)]), 20)
    // two errors
    assert.equal(await returnFirstNotErroring([sleepForAndReject(10), sleepForAndReject(20), sleepForAndReturn(30)]), 30)
    assert.equal(await returnFirstNotErroring([sleepForAndReject(10), sleepForAndReturn(30), sleepForAndReject(20)]), 30)
    assert.equal(await returnFirstNotErroring([sleepForAndReject(20), sleepForAndReject(10), sleepForAndReturn(30)]), 30)
    assert.equal(await returnFirstNotErroring([sleepForAndReject(20), sleepForAndReturn(30), sleepForAndReject(10)]), 30)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(30), sleepForAndReject(10), sleepForAndReject(20)]), 30)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(30), sleepForAndReject(20), sleepForAndReject(10)]), 30)
  })
  it("rejects with right error message if everything errors out", async () => {
    await assert.rejects(returnFirstNotErroring([sleepForAndError(10), sleepForAndError(20), sleepForAndError(30)]), {
      message: "10 && 20 && 30",
    })
    await assert.rejects(returnFirstNotErroring([sleepForAndError(10), sleepForAndError(30), sleepForAndError(20)]), {
      message: "10 && 30 && 20",
    })
    await assert.rejects(returnFirstNotErroring([sleepForAndError(20), sleepForAndError(10), sleepForAndError(30)]), {
      message: "20 && 10 && 30",
    })
    await assert.rejects(returnFirstNotErroring([sleepForAndError(20), sleepForAndError(30), sleepForAndError(10)]), {
      message: "20 && 30 && 10",
    })
    await assert.rejects(returnFirstNotErroring([sleepForAndError(30), sleepForAndError(10), sleepForAndError(20)]), {
      message: "30 && 10 && 20",
    })
    await assert.rejects(returnFirstNotErroring([sleepForAndError(30), sleepForAndError(20), sleepForAndError(10)]), {
      message: "30 && 20 && 10",
    })
  })
  it("if more promises are already resolved, resolves returning the first in the array", async () => {
    const resolvedTen = Promise.resolve(10)
    const resolvedTwenty = Promise.resolve(20)
    const resolvedThirty = Promise.resolve(30)
    // all already resolved
    assert.equal(await returnFirstNotErroring([resolvedTen, resolvedTwenty, resolvedThirty]), 10)
    assert.equal(await returnFirstNotErroring([resolvedTen, resolvedThirty, resolvedTwenty]), 10)
    assert.equal(await returnFirstNotErroring([resolvedTwenty, resolvedTen, resolvedThirty]), 20)
    assert.equal(await returnFirstNotErroring([resolvedTwenty, resolvedThirty, resolvedTen]), 20)
    assert.equal(await returnFirstNotErroring([resolvedThirty, resolvedTen, resolvedTwenty]), 30)
    assert.equal(await returnFirstNotErroring([resolvedThirty, resolvedTwenty, resolvedTen]), 30)
    // one not yet resolved
    assert.equal(await returnFirstNotErroring([sleepForAndReject(10), resolvedTwenty, resolvedThirty]), 20)
    assert.equal(await returnFirstNotErroring([sleepForAndReject(10), resolvedThirty, resolvedTwenty]), 30)
    assert.equal(await returnFirstNotErroring([resolvedTwenty, sleepForAndReject(10), resolvedThirty]), 20)
    assert.equal(await returnFirstNotErroring([resolvedTwenty, resolvedThirty, sleepForAndReject(10)]), 20)
    assert.equal(await returnFirstNotErroring([resolvedThirty, sleepForAndReject(10), resolvedTwenty]), 30)
    assert.equal(await returnFirstNotErroring([resolvedThirty, resolvedTwenty, sleepForAndReject(10)]), 30)
  })
  it("if input is not an iterator, returns a promise rejecting with internal error", async () => {
    const resolvedTen = Promise.resolve(10)
    const resolvedTwenty = Promise.resolve(20)
    const resolvedThirty = Promise.resolve(30)
    //  good call: returnFirstNotErroring([resolvedTen, resolvedTwenty, resolvedThirty])
    const badCall = returnFirstNotErroring(resolvedTen, resolvedTwenty, resolvedThirty)
    assert(badCall instanceof Promise)
    await assert.rejects(badCall, {
      message: "promiseArray.slice is not a function",
    })
  })
  it("works if some array entries are not promises", async () => {
    assert.equal(await returnFirstNotErroring([sleepForAndError(10), sleepForAndReturn(20), 0]), 0)
    assert.equal(await returnFirstNotErroring([sleepForAndError(10), 0, sleepForAndReturn(20)]), 0)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(20), sleepForAndError(10), 0]), 0)
    assert.equal(await returnFirstNotErroring([sleepForAndReturn(20), 0, sleepForAndError(10)]), 0)
    assert.equal(await returnFirstNotErroring([0, sleepForAndError(10), sleepForAndReturn(20)]), 0)
    assert.equal(await returnFirstNotErroring([0, sleepForAndReturn(20), sleepForAndError(10)]), 0)
  })
})
