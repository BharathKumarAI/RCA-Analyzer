import React from 'react';
import { Metrics } from './Metrics';

export function Insights({ initialMode }: { initialMode?: 'live' | 'demo' } = {}) {
  return <Metrics initialMode={initialMode} projectWorkspace={true} />;
}
