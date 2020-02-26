module.exports = {
  env: {
    browser: true,
    commonjs: true,
    es6: true,
    node: true,
  },
  extends: "eslint:recommended",
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 2018,
  },
  plugins: ["react"],
  rules: {
    indent: ["error", 2, { SwitchCase: 1 }],
    "linebreak-style": ["error", "unix"],
    quotes: ["error", "double"],
    semi: ["error", "never"],
    "prefer-const": ["error"],
    "no-var": ["error"],
  },
  globals: {
    artifacts: false,
    contract: false,
    assert: false,
    web3: false,
  },
}
