export class HandOrder {
  constructor(compare) {
    this.compare = compare;
    this.ids = [];
    this.freshId = null;
  }

  reset(hand) {
    this.ids = hand.slice().sort(this.compare);
    this.freshId = null;
  }

  sync(hand, freshId = null) {
    const present = new Set(hand);
    this.ids = this.ids.filter(id => present.has(id));
    const known = new Set(this.ids);
    const added = hand.filter(id => !known.has(id)).sort(this.compare);
    this.ids.push(...added);

    if (freshId !== null && present.has(freshId) && freshId !== this.freshId) {
      this.ids = this.ids.filter(id => id !== freshId);
      this.ids.push(freshId);
    }
    this.freshId = freshId !== null && present.has(freshId) ? freshId : null;
    return this.ids.slice();
  }

  move(id, targetId, before = true) {
    if (id === targetId || !this.ids.includes(id) || !this.ids.includes(targetId)) return false;
    const next = this.ids.filter(card => card !== id);
    const index = next.indexOf(targetId) + (before ? 0 : 1);
    next.splice(index, 0, id);
    this.ids = next;
    return true;
  }

  moveToEnd(id) {
    if (!this.ids.includes(id)) return false;
    this.ids = this.ids.filter(card => card !== id);
    this.ids.push(id);
    return true;
  }
}
