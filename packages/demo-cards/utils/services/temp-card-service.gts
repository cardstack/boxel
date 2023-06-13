export class TempCardService {
  async createCard(realmUrl: URL, data: any) {
    const response = await fetch(realmUrl.href, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.card+json',
      },
      body: JSON.stringify(data),
    });
    if (response.ok) {
      console.log('Card succesfully created');
    }
  }
}
