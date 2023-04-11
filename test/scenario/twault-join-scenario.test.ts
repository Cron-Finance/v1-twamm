import { itBehavesAsNormalJoin } from './twault-join.behavior';

describe('TWAULT Join Scenario Suite', function () {
  context('for a 1, 18 decimal token pool', () => {
    itBehavesAsNormalJoin(1, 18);
  });
  context('for a 6, 18 decimal token pool', () => {
    itBehavesAsNormalJoin(6, 18);
  });
  context('for a 12, 18 decimal token pool', () => {
    itBehavesAsNormalJoin(12, 18);
  });
  context('for a 18, 18 decimal token pool', () => {
    itBehavesAsNormalJoin(18, 18);
  });
})