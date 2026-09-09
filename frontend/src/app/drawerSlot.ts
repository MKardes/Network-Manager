import { createContext, useContext } from 'react';

/**
 * The rail shell owns the drawer's position (a sticky flex sibling of the main
 * column, outside its padding) while the Devices page owns its contents. The
 * shell publishes an empty element here and the page portals into it.
 */
export const DrawerSlotContext = createContext<HTMLElement | null>(null);

export function useDrawerSlot(): HTMLElement | null {
  return useContext(DrawerSlotContext);
}
