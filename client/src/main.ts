// Ponto de entrada do cliente: store (dados) -> mundo (canvas) -> UI (painéis).
import { OfficeStore } from './net/store';
import { createWorld } from './world';
import { createUI } from './ui';
import { migrateLegacyKeys, safeLocalStorage } from './ui/prefs';

// Antes de tudo: o mundo (carteiras) e a UI (preferências) leem o localStorage ao serem criados.
migrateLegacyKeys(safeLocalStorage());

const params = new URLSearchParams(location.search);
const isFile = location.protocol === 'file:';
const isMock = params.has('mock') || params.has('factory') || isFile;
const isFactory =
  params.has('factory') ||
  (!params.has('mock') && (
    typeof (window as unknown as { __FACTORY_DEFAULT__?: boolean }).__FACTORY_DEFAULT__ !== 'undefined' ||
    document.documentElement.dataset.mode === 'factory' ||
    isFile ||
    location.pathname.includes('/office') ||
    location.pathname.includes('proto-office') ||
    location.pathname.includes('factory-office')
  ));

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
