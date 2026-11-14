export function Lights() {
  return (
    <>
      <ambientLight intensity={0.05} />
      <pointLight position={[0, 0, 0]} intensity={2} decay={0} />
    </>
  )
}
