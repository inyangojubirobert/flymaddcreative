export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/Onedream.html',
      permanent: false
    }
  };
}

export default function Home() {
  return null;
}
