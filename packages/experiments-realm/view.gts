import { FieldDef } from 'https://cardstack.com/base/card-api';

// this view field controls the toggle to specify the view of the collection
export class ViewField extends FieldDef {
  static displayName = 'Collection View';

  // .     card-chooser + ,cards-grid, table (app-card), board don't touch yet
  views = ['list', 'grid', 'table', 'board'];
}
// class View extends GlimmerComponent<{

// }>

// class GridView extends GlimmerComponent<{

// }>
// class ListView extends GlimmerComponent<{

// }>
// class TableView extends GlimmerComponent<{

// }>
// class BoardView extends GlimmerComponent<{

// }>
