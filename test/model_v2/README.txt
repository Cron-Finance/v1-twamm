An update to the original model that includes the following significant changes:

  - modelling of order amounts received for each token
  - modelling of proceeds received for each token
  - differential twamm reserve calculation (replaces twammReserve in state and 
    automatically syncs with balancer vault balances)
  - Cron-Fi fees