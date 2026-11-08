// Ponto de entrada do cliente: store (dados) -> mundo (canvas) -> UI (painéis).
import { startPublic } from './public';
import { OfficeStore } from './net/store';
import { createWorld } from './world';
import { createUI } from './ui';
import { migrateLegacyKeys, safeLocalStorage } from './ui/prefs';

// Antes de tudo: o mundo (carteiras) e a UI (preferências) leem o localStorage ao serem criados.
migrateLegacyKeys(safeLocalStorage());

const params = new URLSearchParams(location.search);
const isPublic = import.meta.env.VITE_PUBLIC === '1' || params.has('public');
if (isPublic) startPublic();
else startPrivate();

function startPrivate(): void {
const isFile = location.protocol === 'file:';
const hasFactoryParam = params.has('factory');
const isFactoryBuild =
  typeof (window as unknown as { __FACTORY_DEFAULT__?: boolean }).__FACTORY_DEFAULT__ !== 'undefined' ||
  document.documentElement.dataset.mode === 'factory';
const isFactory = hasFactoryParam || isFactoryBuild;
const isMock = params.has('mock') || (isFactory ? (hasFactoryParam || isFile) : isFile);

const store = new OfficeStore({
  mock: isMock,
  factory: isFactory,
  search: location.search,
});
const world = createWorld(document.getElementById('world') as HTMLCanvasElement, store);
createUI(document.getElementById('ui') as HTMLElement, store, world);
store.connect();

// Facilita a depuração pelo console do navegador.
Object.assign(window, { habblaud: { store, world } });
}
