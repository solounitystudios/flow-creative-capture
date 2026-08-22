import { validateCheckpointChain } from '../provenance/checkpoint.js';
import { runColdNightsScenario } from './coldNights.js';

function main(): void {
  const scenario = runColdNightsScenario();
  const chain = validateCheckpointChain(scenario.checkpoints);

  console.log(`Project: ${scenario.project.title} (${scenario.project.id})`);
  console.log(`Sessions: ${scenario.nightwireSession.id}, ${scenario.marcusSession.id}`);
  console.log(`Events captured: ${scenario.events.length}`);
  console.log(`Assets: ${Object.keys(scenario.assets).length}`);
  console.log(`Asset relationships: ${scenario.relationships.length}`);
  console.log(`Checkpoints: ${scenario.checkpoints.length} (chain valid: ${chain.valid})`);
  console.log(`Handoff status: ${scenario.handoff.status}`);
  console.log(`Release candidate: ${scenario.releaseCandidate.versionLabel} (${scenario.releaseCandidate.status})`);
}

main();
