export NETWORKS_FILE='../node_modules/@gnosis.pm/dex-contracts/networks.json'
CONF_FILE=$(pwd)'/migrations/migration_conf.js' node node_modules/@gnosis.pm/util-contracts/src/inject_network_info.js

export NETWORKS_FILE='../networks.json'
CONF_FILE=$(pwd)'/migrations/migration_conf.js' node node_modules/@gnosis.pm/util-contracts/src/inject_network_info.js
