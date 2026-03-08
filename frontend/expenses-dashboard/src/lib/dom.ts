export function getRequiredElement<T extends Element>(id: string): T {
  const element = document.getElementById(id)

  if (!element) {
    throw new Error(`Missing required element: #${id}`)
  }

  return element as unknown as T
}

export function clearElement(element: Element): void {
  while (element.firstChild) {
    element.removeChild(element.firstChild)
  }
}
