import * as React from 'react';
import renderer, { act, ReactTestRenderer } from 'react-test-renderer';

import { ThemedText } from '../ThemedText';

it(`renders correctly`, async () => {
  let root: ReactTestRenderer | undefined;
  await act(async () => {
    root = renderer.create(<ThemedText>Snapshot test!</ThemedText>);
  });

  expect(root?.toJSON()).toMatchSnapshot();
});
